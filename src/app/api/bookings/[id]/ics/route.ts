import { lookupUpcoming, normalizeBookingId } from "@/lib/bookings";
import { getClinic } from "@/lib/clinic";
import { bookingIcs } from "@/lib/ics";

export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/bookings/[id]/ics">,
) {
  const id = normalizeBookingId((await ctx.params).id);
  const nowMs = Date.now();
  const booking = id ? await lookupUpcoming(id, nowMs) : null;
  if (!booking) return new Response("Not found", { status: 404 });
  return new Response(bookingIcs(booking, await getClinic(), nowMs), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="tring-${booking.id}.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
