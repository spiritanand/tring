"use client";

import type { Step, TurnRecord } from "@/lib/agent/types";

const tone: Record<Step["status"], string> = {
  info: "text-muted",
  ok: "text-emerald-300",
  blocked: "text-rose-300",
  error: "text-rose-300",
};

const kindLabel: Record<Step["kind"], string> = {
  input: "Input",
  model: "Model",
  guard: "Guard",
  tool: "Tool",
  state: "State",
};

export function StepsPanel({ turns }: { turns: TurnRecord[] }) {
  if (turns.length === 0) {
    return (
      <p className="p-4 text-meta text-muted">
        Each message you send appears here as the steps Tring took: what the
        model proposed, what the guards allowed or blocked, which tool ran, and
        what state changed.
      </p>
    );
  }
  return (
    <ol className="divide-y divide-line">
      {[...turns].reverse().map((turn, index) => (
        <li
          key={turn.id || `t-${turn.createdAt}`}
          className={`p-4 ${index === 0 ? "bg-wash" : ""}`}
        >
          <p className="label mb-2 flex items-center justify-between">
            <span>Turn {turns.length - index}</span>
            {index === 0 && <span className="chip-warn">Latest</span>}
          </p>
          <ul className="space-y-2">
            {turn.steps.map((step, i) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are an append-only log for a finished turn
                key={i}
                className="grid grid-cols-[3.25rem_1fr] gap-x-2 font-mono text-xs leading-relaxed"
              >
                <span
                  className={`${tone[step.status]} flex items-center gap-1.5`}
                >
                  <span className="dot" />
                  {kindLabel[step.kind]}
                </span>
                <span className="min-w-0 break-words">
                  <span className="text-ink">{step.label}</span>
                  <span className="block text-muted">{step.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
