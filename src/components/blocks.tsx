"use client";

import { CalendarPlus, Check, Copy, Phone } from "lucide-react";
import { useEffect, useState } from "react";
import type { Block, SummaryBlock, Tap } from "@/lib/agent/types";
import { fmtDate, fmtTime, istDate, istMinutes } from "@/lib/time";

type Send = (tap: Tap) => void;

const showId = (id: string) => `${id.slice(0, 4)}-${id.slice(4)}`;
const range = (startAt: number, endAt: number) =>
  `${fmtTime(istMinutes(startAt))} to ${fmtTime(istMinutes(endAt))}`;

function SlotChip({
  startAt,
  onPick,
  disabled,
}: {
  startAt: number;
  onPick: Send;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick({ kind: "slot", startAt })}
      className="h-9 rounded-md border border-line-strong px-3 text-sm tabular-nums transition-colors hover:border-brand hover:text-brand disabled:pointer-events-none disabled:opacity-40"
    >
      {fmtDate(istDate(startAt))} · {fmtTime(istMinutes(startAt))}
    </button>
  );
}

function Picker({
  initialDate,
  onPick,
}: {
  initialDate: string | null;
  onPick: Send;
}) {
  const [days, setDays] = useState<Array<{
    date: string;
    slots: number[];
  }> | null>(null);
  const [chosen, setChosen] = useState<string | null>(initialDate);

  useEffect(() => {
    let live = true;
    fetch("/api/slots")
      .then((r) => r.json())
      .then((data: { days: Array<{ date: string; slots: number[] }> }) => {
        if (!live) return;
        setDays(data.days);
        setChosen((current) => {
          const usable = data.days.find(
            (d) => d.date === current && d.slots.length > 0,
          );
          return (
            usable?.date ??
            data.days.find((d) => d.slots.length > 0)?.date ??
            null
          );
        });
      })
      .catch(() => live && setDays([]));
    return () => {
      live = false;
    };
  }, []);

  if (days === null)
    return (
      <div className="h-24 animate-pulse rounded-lg border border-line bg-wash" />
    );
  if (days.length === 0) return null;
  const times = days.find((d) => d.date === chosen)?.slots ?? [];

  return (
    <div className="rounded-lg border border-line bg-wash">
      <div className="flex gap-1.5 overflow-x-auto border-b border-line p-2">
        {days.map((day) => {
          const [weekday, dayOfMonth] = fmtDate(day.date).split(" ");
          const active = day.date === chosen;
          return (
            <button
              key={day.date}
              type="button"
              disabled={day.slots.length === 0}
              onClick={() => setChosen(day.date)}
              className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-md border text-xs transition-colors disabled:pointer-events-none disabled:opacity-30 ${
                active
                  ? "border-brand bg-brand text-on-brand"
                  : "border-line text-ink-2 hover:border-line-strong"
              }`}
            >
              <span>{weekday}</span>
              <span className="text-base font-medium tabular-nums">
                {dayOfMonth}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-1.5 p-2 sm:grid-cols-4">
        {times.length === 0 && (
          <p className="col-span-full px-1 py-2 text-meta text-muted">
            No free times that day.
          </p>
        )}
        {times.map((startAt) => (
          <button
            key={startAt}
            type="button"
            onClick={() => onPick({ kind: "slot", startAt })}
            className="h-9 rounded-md border border-line text-sm tabular-nums transition-colors hover:border-brand hover:text-brand"
          >
            {fmtTime(istMinutes(startAt))}
          </button>
        ))}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="label shrink-0">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

function Summary({
  block,
  onTap,
  active,
}: {
  block: SummaryBlock;
  onTap: Send;
  active: boolean;
}) {
  const labels = {
    book: { title: "Check your booking", yes: "Confirm booking", no: "Change" },
    cancel: {
      title: "Cancel this appointment?",
      yes: "Yes, cancel it",
      no: "Keep it",
    },
    reschedule: {
      title: "Check the new time",
      yes: "Confirm new time",
      no: "Change",
    },
  }[block.kind];
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{labels.title}</h3>
        <span className="chip-warn">
          <span className="dot" />
          Not confirmed yet
        </span>
      </div>
      <dl className="mt-2 divide-y divide-line">
        <Row label="When">
          <span className={block.kind === "cancel" ? "" : "text-brand"}>
            {fmtDate(istDate(block.startAt))}
          </span>
          {", "}
          <span className="tabular-nums">
            {range(block.startAt, block.endAt)}
          </span>
        </Row>
        {block.previousStartAt !== null && (
          <Row label="Moving from">
            <span className="text-muted line-through tabular-nums">
              {fmtDate(istDate(block.previousStartAt))},{" "}
              {fmtTime(istMinutes(block.previousStartAt))}
            </span>
          </Row>
        )}
        <Row label="Patient">{block.patientName}</Row>
        <Row label="Mobile">
          <span className="font-mono text-meta">{block.phoneMasked}</span>
        </Row>
        <Row label="Reason">{block.reason}</Row>
        {block.bookingId && (
          <Row label="Booking ID">
            <span className="font-mono">{showId(block.bookingId)}</span>
          </Row>
        )}
      </dl>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={!active}
          className="btn flex-1"
          onClick={() => onTap({ kind: "confirm", ...block.confirmToken })}
        >
          {labels.yes}
        </button>
        <button
          type="button"
          disabled={!active}
          className="btn-ghost"
          onClick={() => onTap({ kind: "change" })}
        >
          {labels.no}
        </button>
      </div>
    </div>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label="Copy booking ID"
      className="btn-ghost btn-sm"
      onClick={() => {
        navigator.clipboard?.writeText(showId(id)).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? (
        <Check size={14} strokeWidth={1.75} />
      ) : (
        <Copy size={14} strokeWidth={1.75} />
      )}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function BlockView({
  block,
  active,
  onTap,
  doctorName,
}: {
  block: Block;
  active: boolean;
  onTap: Send;
  doctorName: string;
}) {
  switch (block.type) {
    case "text":
      return (
        <p className="whitespace-pre-line text-[15px] leading-relaxed text-ink">
          {block.text}
        </p>
      );
    case "slots":
      return (
        <div className="flex flex-wrap gap-2">
          {block.slots.map((startAt) => (
            <SlotChip
              key={startAt}
              startAt={startAt}
              onPick={onTap}
              disabled={!active}
            />
          ))}
        </div>
      );
    case "picker":
      return active ? <Picker initialDate={block.date} onPick={onTap} /> : null;
    case "summary":
      return <Summary block={block} onTap={onTap} active={active} />;
    case "booked":
      return (
        <div className="card border-emerald-400/30">
          <div className="flex items-center justify-between">
            <span className="chip-ok">
              <span className="dot" />
              {block.kind === "booked" ? "Confirmed" : "Moved"}
            </span>
            <a
              className="btn-ghost btn-sm"
              href={`/api/bookings/${block.bookingId}/ics`}
            >
              <CalendarPlus size={14} strokeWidth={1.75} />
              Add to calendar
            </a>
          </div>
          <p className="mt-3 text-heading">
            {fmtDate(istDate(block.startAt))},{" "}
            <span className="tabular-nums">
              {fmtTime(istMinutes(block.startAt))}
            </span>
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            {block.patientName} with {doctorName}
          </p>
          <div className="mt-3 flex items-center justify-between rounded-md border border-line bg-paper px-3 py-2">
            <div>
              <p className="label">Booking ID</p>
              <p className="font-mono text-lg tracking-wide text-brand">
                {showId(block.bookingId)}
              </p>
            </div>
            <CopyId id={block.bookingId} />
          </div>
        </div>
      );
    case "cancelled":
      return (
        <div className="card">
          <span className="chip-bad">
            <span className="dot" />
            Cancelled
          </span>
          <p className="mt-2 text-sm text-muted line-through tabular-nums">
            {fmtDate(istDate(block.startAt))},{" "}
            {fmtTime(istMinutes(block.startAt))}
          </p>
          <p className="mt-1 font-mono text-meta text-muted">
            {showId(block.bookingId)}
          </p>
        </div>
      );
    case "contact":
      return (
        <a
          className="btn-ghost w-fit"
          href={`tel:${block.phone.replace(/\s/g, "")}`}
        >
          <Phone size={16} strokeWidth={1.75} />
          Call {block.phone}
        </a>
      );
  }
}
