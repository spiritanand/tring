import { inArray } from "drizzle-orm";
import { db, schema } from "../src/db";
import { createBooking, newBookingId } from "../src/lib/bookings";

// Fires parallel bookings for one slot at whichever database the environment points to; exactly one may win.
const now = Date.now();
const startAt = now + 13 * 86_400_000;
const ids = Array.from({ length: 20 }, () => newBookingId());
const started = Date.now();
const results = await Promise.all(
  ids.map((id, i) =>
    createBooking(
      {
        id,
        patientName: "Race Test",
        phone: `90000000${String(i).padStart(2, "0")}`,
        reason: "race check",
        startAt,
        endAt: startAt + 15 * 60_000,
        sessionId: `race-${id}`,
      },
      5,
      now,
    ),
  ),
);
const winners = results.filter((r) => r.ok).length;
console.log(
  `${ids.length} parallel bookings for one slot → ${winners} succeeded, ${ids.length - winners} refused (${Date.now() - started} ms)`,
);
await db.delete(schema.bookings).where(inArray(schema.bookings.id, ids));
process.exit(winners === 1 ? 0 : 1);
