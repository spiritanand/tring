"use client";

import {
  BellRing,
  PanelRightClose,
  PanelRightOpen,
  SendHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Tap, TurnInput, TurnRecord } from "@/lib/agent/types";
import { fmtSlot } from "@/lib/time";
import { BlockView } from "./blocks";
import { StepsPanel } from "./steps";

type ClinicInfo = { name: string; doctorName: string; phone: string };
type SessionData = {
  clinic: ClinicInfo;
  turns: TurnRecord[];
  current: { bookingId: string; startAt: number; endAt: number } | null;
};

const QUICK = [
  "Book an appointment",
  "Reschedule my appointment",
  "Cancel my appointment",
  "What are your fees and hours?",
];

function inputLabel(input: TurnInput): string {
  if (input.type === "text") return input.text;
  if (input.tap.kind === "slot") return fmtSlot(input.tap.startAt);
  return input.tap.kind === "confirm" ? "Confirm" : "Change";
}

export function Chat() {
  const [data, setData] = useState<SessionData | null>(null);
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [sending, setSending] = useState<TurnInput | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [showSteps, setShowSteps] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/session");
    const session: SessionData = await response.json();
    setData(session);
    setTurns(session.turns);
  }, []);

  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [load]);

  const turnCount = turns.length;
  useEffect(() => {
    if (turnCount >= 0 || sending)
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turnCount, sending]);

  const send = useCallback(
    async (input: TurnInput) => {
      if (busy.current) return;
      busy.current = true;
      setSending(input);
      setFailed(false);
      try {
        const response = await fetch("/api/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        if (response.status === 409) await load();
        else if (!response.ok) setFailed(true);
        else {
          const result: { turn: TurnRecord } = await response.json();
          setTurns((previous) => [...previous, result.turn]);
        }
      } catch {
        setFailed(true);
      } finally {
        busy.current = false;
        setSending(null);
      }
    },
    [load],
  );

  const sendText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraft("");
    send({ type: "text", text: trimmed });
  };
  const sendTap = (tap: Tap) => send({ type: "tap", tap });
  const clinic = data?.clinic;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <BellRing size={18} strokeWidth={1.75} className="text-brand" />
          <span className="text-[20px] font-semibold tracking-[-0.03em]">
            tring<span className="text-brand">.</span>
          </span>
          {clinic && (
            <span className="hidden text-meta text-muted sm:inline">
              booking desk · {clinic.name}
            </span>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-pressed={showSteps}
          onClick={() => setShowSteps((v) => !v)}
        >
          {showSteps ? (
            <PanelRightClose size={14} strokeWidth={1.75} />
          ) : (
            <PanelRightOpen size={14} strokeWidth={1.75} />
          )}
          {showSteps ? "Hide agent steps" : "Show agent steps"}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-6 sm:px-6">
              <div className="flex flex-col gap-3">
                <p className="text-[15px] leading-relaxed">
                  {clinic
                    ? `Hi, I'm Tring, the booking desk at ${clinic.name}. I can book, move or cancel an appointment with ${clinic.doctorName}.`
                    : "Hi, I'm Tring. One moment while I open the appointment book."}
                </p>
                <p className="text-meta text-muted">
                  Tell me a day and time in your own words, in English or
                  Hinglish, or start with one of these.
                </p>
                {data?.current && (
                  <p className="card text-sm">
                    <span className="label block">
                      Your upcoming appointment
                    </span>
                    <span className="tabular-nums">
                      {fmtSlot(data.current.startAt)}
                    </span>
                    <span className="ml-2 font-mono text-meta text-brand">
                      {data.current.bookingId.slice(0, 4)}-
                      {data.current.bookingId.slice(4)}
                    </span>
                  </p>
                )}
                {turns.length === 0 && (
                  <div className="flex flex-wrap gap-2">
                    {QUICK.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={!data || Boolean(sending)}
                        className="btn-ghost btn-sm"
                        onClick={() => sendText(q)}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {turns.map((turn, index) => {
                const active = index === turns.length - 1 && !sending;
                return (
                  <div
                    key={turn.id || `t-${turn.createdAt}`}
                    className="flex flex-col gap-3"
                  >
                    <p className="ml-auto max-w-[85%] rounded-lg border border-line bg-raise px-3.5 py-2 text-[15px] break-words">
                      {inputLabel(turn.input)}
                    </p>
                    {turn.reply.map((block, i) => (
                      <BlockView
                        // biome-ignore lint/suspicious/noArrayIndexKey: reply blocks of a finished turn never reorder
                        key={i}
                        block={block}
                        active={active}
                        onTap={sendTap}
                        doctorName={clinic?.doctorName ?? "the doctor"}
                      />
                    ))}
                  </div>
                );
              })}

              {sending && (
                <div className="flex flex-col gap-3">
                  <p className="ml-auto max-w-[85%] rounded-lg border border-line bg-raise px-3.5 py-2 text-[15px] break-words">
                    {inputLabel(sending)}
                  </p>
                  <p className="flex items-center gap-2 text-meta text-muted">
                    <span className="size-1.5 animate-pulse rounded-full bg-brand" />
                    Checking the appointment book
                  </p>
                </div>
              )}
              {failed && (
                <p className="chip-bad h-auto w-fit py-1.5 whitespace-normal">
                  Couldn't reach Tring. Nothing was changed. Please try again.
                </p>
              )}
              <div ref={endRef} />
            </div>
          </div>

          <form
            className="shrink-0 border-t border-line"
            onSubmit={(event) => {
              event.preventDefault();
              sendText(draft);
            }}
          >
            <div className="mx-auto flex w-full max-w-2xl gap-2 px-4 py-3 sm:px-6">
              <input
                className="input h-11 text-base"
                value={draft}
                maxLength={500}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Tomorrow 5pm, or kal shaam 5 baje"
                aria-label="Message Tring"
                enterKeyHint="send"
                autoComplete="off"
              />
              <button
                type="submit"
                className="btn h-11"
                disabled={!draft.trim() || Boolean(sending) || !data}
                aria-label="Send"
              >
                <SendHorizontal size={16} strokeWidth={1.75} />
              </button>
            </div>
          </form>
        </section>

        {showSteps && (
          <aside className="max-h-[42dvh] shrink-0 overflow-y-auto border-t border-line lg:max-h-none lg:w-[420px] lg:border-t-0 lg:border-l">
            <div className="sticky top-0 border-b border-line bg-paper px-4 py-2.5">
              <h2 className="text-sm font-medium">Agent steps</h2>
              <p className="text-meta text-muted">
                The model proposes one action. Code checks it, runs the tool and
                writes the reply.
              </p>
            </div>
            <StepsPanel turns={turns} />
          </aside>
        )}
      </div>
    </div>
  );
}
