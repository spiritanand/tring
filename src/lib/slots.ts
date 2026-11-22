import type { WeeklyHours } from "@/db/schema";
import {
  addDays,
  istDate,
  istMinutes,
  istToMs,
  parseHHMM,
  upcomingDates,
  weekdayOf,
} from "./time";

export const HORIZON_DAYS = 14;
export const LEAD_MINUTES = 15;

export type SlotConfig = {
  slotMinutes: number;
  bufferMinutes: number;
  weeklyHours: WeeklyHours;
};
export type Busy = { startAt: number; endAt: number };
export type SlotProblem =
  | "past"
  | "beyond_horizon"
  | "closed_day"
  | "outside_hours"
  | "taken";

type Ranges = Array<{ start: number; end: number }>;

function rangesFor(date: string, config: SlotConfig): Ranges {
  const key = String(weekdayOf(date)) as keyof WeeklyHours;
  return (config.weeklyHours[key] ?? [])
    .map((r) => ({ start: parseHHMM(r.start), end: parseHHMM(r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
}

export function gridFor(date: string, config: SlotConfig): number[] {
  const step = config.slotMinutes + config.bufferMinutes;
  const starts: number[] = [];
  for (const range of rangesFor(date, config)) {
    for (let t = range.start; t + config.slotMinutes <= range.end; t += step)
      starts.push(t);
  }
  return starts;
}

export function overlaps(
  startAt: number,
  endAt: number,
  busy: Busy[],
  bufferMinutes: number,
): boolean {
  const buffer = bufferMinutes * 60_000;
  return busy.some(
    (b) => startAt < b.endAt + buffer && b.startAt < endAt + buffer,
  );
}

export function earliestBookable(nowMs: number): number {
  return nowMs + LEAD_MINUTES * 60_000;
}

export function inHorizon(date: string, nowMs: number): boolean {
  const today = istDate(nowMs);
  return date >= today && date <= addDays(today, HORIZON_DAYS - 1);
}

export function freeSlotsOn(
  date: string,
  config: SlotConfig,
  busy: Busy[],
  nowMs: number,
): number[] {
  if (!inHorizon(date, nowMs)) return [];
  const length = config.slotMinutes * 60_000;
  return gridFor(date, config)
    .map((minutes) => istToMs(date, minutes))
    .filter(
      (start) =>
        start >= earliestBookable(nowMs) &&
        !overlaps(start, start + length, busy, config.bufferMinutes),
    );
}

export function allFreeSlots(
  config: SlotConfig,
  busy: Busy[],
  nowMs: number,
): number[] {
  return upcomingDates(nowMs, HORIZON_DAYS).flatMap((date) =>
    freeSlotsOn(date, config, busy, nowMs),
  );
}

export function checkSlot(
  date: string,
  minutes: number,
  config: SlotConfig,
  busy: Busy[],
  nowMs: number,
):
  | { ok: true; startAt: number; endAt: number }
  | { ok: false; problem: SlotProblem } {
  const today = istDate(nowMs);
  if (date < today) return { ok: false, problem: "past" };
  if (date > addDays(today, HORIZON_DAYS - 1))
    return { ok: false, problem: "beyond_horizon" };
  const startAt = istToMs(date, minutes);
  if (startAt < earliestBookable(nowMs)) return { ok: false, problem: "past" };
  if (rangesFor(date, config).length === 0)
    return { ok: false, problem: "closed_day" };
  if (!gridFor(date, config).includes(minutes))
    return { ok: false, problem: "outside_hours" };
  const endAt = startAt + config.slotMinutes * 60_000;
  if (overlaps(startAt, endAt, busy, config.bufferMinutes))
    return { ok: false, problem: "taken" };
  return { ok: true, startAt, endAt };
}

export function nearestFree(
  targetMs: number,
  free: number[],
  count: number,
): number[] {
  return [...free]
    .sort((a, b) => Math.abs(a - targetMs) - Math.abs(b - targetMs) || a - b)
    .slice(0, count)
    .sort((a, b) => a - b);
}

export function snapToGrid(
  date: string,
  minutes: number,
  config: SlotConfig,
): number | null {
  const grid = gridFor(date, config);
  if (grid.includes(minutes)) return minutes;
  const tolerance = Math.floor((config.slotMinutes + config.bufferMinutes) / 2);
  const closest = grid.reduce<number | null>(
    (best, g) =>
      best === null || Math.abs(g - minutes) < Math.abs(best - minutes)
        ? g
        : best,
    null,
  );
  return closest !== null && Math.abs(closest - minutes) <= tolerance
    ? closest
    : null;
}

export function resolveBareHour(
  date: string,
  hour: number,
  minute: number,
  config: SlotConfig,
): number {
  const asGiven = hour * 60 + minute;
  if (hour < 1 || hour > 11) return asGiven;
  const shifted = asGiven + 12 * 60;
  const inside = (m: number) =>
    rangesFor(date, config).some((r) => m >= r.start && m < r.end);
  return !inside(asGiven) && inside(shifted) ? shifted : asGiven;
}

export function partOfDayWindow(
  part: "morning" | "afternoon" | "evening",
): [number, number] {
  if (part === "morning") return [0, 12 * 60];
  if (part === "afternoon") return [12 * 60, 17 * 60];
  return [17 * 60, 24 * 60];
}

export function slotMinutesOfDay(startAt: number): number {
  return istMinutes(startAt);
}
