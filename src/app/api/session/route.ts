import { listTurns, loadSession } from "@/lib/agent/session";
import { lookupUpcoming } from "@/lib/bookings";
import { getClinic } from "@/lib/clinic";
import { ensureSessionId, startNewSession } from "@/lib/session-cookie";

export async function GET() {
  const sessionId = await ensureSessionId();
  const [clinic, turns, { state }] = await Promise.all([
    getClinic(),
    listTurns(sessionId),
    loadSession(sessionId),
  ]);
  const current = state.lastBookingId
    ? await lookupUpcoming(state.lastBookingId, Date.now())
    : null;
  return Response.json({
    clinic: {
      name: clinic.name,
      doctorName: clinic.doctorName,
      phone: clinic.phone,
    },
    turns,
    current: current && {
      bookingId: current.id,
      startAt: current.startAt,
      endAt: current.endAt,
    },
  });
}

// A new chat is a new session cookie. Earlier bookings stay in the database and are reached by booking ID.
export async function POST() {
  await startNewSession();
  return Response.json({ ok: true });
}
