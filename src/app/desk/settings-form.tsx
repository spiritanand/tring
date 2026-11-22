"use client";

import { Plus, X } from "lucide-react";
import { useState, useTransition } from "react";
import { type SettingsInput, saveSettings } from "./actions";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
type DayKey = keyof SettingsInput["weeklyHours"];

export function SettingsForm({ initial }: { initial: SettingsInput }) {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<{
    kind: "saved" | "error";
    text: string;
  } | null>(null);
  const [pending, start] = useTransition();

  const set = <K extends keyof SettingsInput>(
    key: K,
    value: SettingsInput[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    setStatus(null);
  };
  const setDay = (key: DayKey, ranges: SettingsInput["weeklyHours"][DayKey]) =>
    set("weeklyHours", { ...form.weeklyHours, [key]: ranges });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const result = await saveSettings(form);
          setStatus(
            result.ok
              ? {
                  kind: "saved",
                  text: "Saved. New bookings follow these settings.",
                }
              : { kind: "error", text: result.error },
          );
        });
      }}
    >
      <div className="card p-0">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-medium">Weekly hours</h3>
          <p className="text-meta text-muted">
            Times the doctor sees patients. Add a second range for a lunch
            break. All times are IST.
          </p>
        </div>
        <ul className="divide-y divide-line">
          {DAYS.map((label, index) => {
            const key = String(index) as DayKey;
            const ranges = form.weeklyHours[key];
            const open = ranges.length > 0;
            return (
              <li
                key={label}
                className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3"
              >
                <label className="flex h-9 w-36 shrink-0 items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={open}
                    onChange={(event) =>
                      setDay(
                        key,
                        event.target.checked
                          ? [{ start: "10:00", end: "13:00" }]
                          : [],
                      )
                    }
                  />
                  {label}
                </label>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  {!open && (
                    <span className="flex h-9 items-center text-meta text-muted">
                      Closed
                    </span>
                  )}
                  {ranges.map((range, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: ranges have no identity beyond their position
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        step={300}
                        className="input h-9 w-32 tabular-nums"
                        value={range.start}
                        aria-label={`${label} opens`}
                        onChange={(event) =>
                          setDay(
                            key,
                            ranges.map((r, j) =>
                              j === i ? { ...r, start: event.target.value } : r,
                            ),
                          )
                        }
                      />
                      <span className="text-muted">to</span>
                      <input
                        type="time"
                        step={300}
                        className="input h-9 w-32 tabular-nums"
                        value={range.end}
                        aria-label={`${label} closes`}
                        onChange={(event) =>
                          setDay(
                            key,
                            ranges.map((r, j) =>
                              j === i ? { ...r, end: event.target.value } : r,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn-ghost btn-sm w-8 px-0"
                        aria-label={`Remove ${label} range`}
                        onClick={() =>
                          setDay(
                            key,
                            ranges.filter((_, j) => j !== i),
                          )
                        }
                      >
                        <X size={14} strokeWidth={1.75} />
                      </button>
                      {i === ranges.length - 1 && ranges.length < 3 && (
                        <button
                          type="button"
                          className="btn-ghost btn-sm w-8 px-0"
                          aria-label={`Add ${label} range`}
                          onClick={() =>
                            setDay(key, [
                              ...ranges,
                              { start: "17:00", end: "20:00" },
                            ])
                          }
                        >
                          <Plus size={14} strokeWidth={1.75} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="label">Consult length</span>
          <select
            className="input"
            value={form.slotMinutes}
            onChange={(e) =>
              set(
                "slotMinutes",
                Number(e.target.value) as SettingsInput["slotMinutes"],
              )
            }
          >
            {[15, 20, 30].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label">Buffer between appointments</span>
          <select
            className="input"
            value={form.bufferMinutes}
            onChange={(e) =>
              set(
                "bufferMinutes",
                Number(e.target.value) as SettingsInput["bufferMinutes"],
              )
            }
          >
            {[0, 5, 10, 15].map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "No buffer" : `${m} minutes`}
              </option>
            ))}
          </select>
        </label>
        {(
          [
            ["name", "Clinic name"],
            ["doctorName", "Doctor"],
            ["phone", "Clinic phone"],
            ["fee", "Consultation fee"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1.5">
            <span className="label">{label}</span>
            <input
              className="input"
              value={form[key]}
              maxLength={60}
              onChange={(e) => set(key, e.target.value)}
            />
          </label>
        ))}
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="label">Address</span>
          <input
            className="input"
            value={form.address}
            maxLength={160}
            onChange={(e) => set("address", e.target.value)}
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Saving" : "Save settings"}
        </button>
        {status && (
          <span
            className={
              status.kind === "saved"
                ? "chip-ok h-auto py-1 whitespace-normal"
                : "chip-bad h-auto py-1 whitespace-normal"
            }
          >
            {status.text}
          </span>
        )}
      </div>
    </form>
  );
}
