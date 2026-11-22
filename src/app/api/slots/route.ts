import { loadSession } from "@/lib/agent/session";
import { busyIntervals } from "@/lib/bookings";
import { getClinic } from "@/lib/clinic";
import { readSessionId } from "@/lib/session-cookie";
import { freeSlotsOn, HORIZON_DAYS } from "@/lib/slots";
import { upcomingDates } from "@/lib/time";

export async function GET() {
  const nowMs = Date.now();
  const sessionId = await readSessionId();
  const [clinic, busy, session] = await Promise.all([
    getClinic(),
    busyIntervals(nowMs),
    sessionId ? loadSession(sessionId) : null,
  ]);
  const moving = session?.state.draft.rescheduleOf ?? null;
  const others = moving ? busy.filter((b) => b.id !== moving) : busy;
  const days = upcomingDates(nowMs, HORIZON_DAYS).map((date) => ({
    date,
    slots: freeSlotsOn(date, clinic, others, nowMs),
  }));
  return Response.json({ days });
}
