// The clinic runs on IST, which has no DST, so a fixed offset is exact and avoids depending on the server's zone.
export const IST_OFFSET_MS = 330 * 60_000;
export const DAY_MS = 86_400_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function istDate(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function istMinutes(ms: number): number {
  const d = new Date(ms + IST_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export function istToMs(date: string, minutes: number): number {
  return Date.parse(`${date}T00:00:00Z`) + minutes * 60_000 - IST_OFFSET_MS;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function parseHHMM(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

export function toHHMM(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function fmtDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function fmtSlot(ms: number): string {
  return `${fmtDate(istDate(ms))}, ${fmtTime(istMinutes(ms))}`;
}

export function upcomingDates(nowMs: number, count: number): string[] {
  const today = istDate(nowMs);
  return Array.from({ length: count }, (_, i) => addDays(today, i));
}

export function relativeLabel(date: string, nowMs: number): string | null {
  const diff = Math.round(
    (Date.parse(`${date}T00:00:00Z`) -
      Date.parse(`${istDate(nowMs)}T00:00:00Z`)) /
      DAY_MS,
  );
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === 2) return "day after tomorrow";
  return null;
}
