import { and, asc, eq, gt, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { db, schema } from "@/db";

export type Booking = typeof schema.bookings.$inferSelect;

const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ID_PATTERN = /^[2-9A-HJ-NP-Z]{8}$/;
const randomId = customAlphabet(ID_ALPHABET, 8);

// Every ID carries a digit so that an ordinary word in a message can never be mistaken for one.
export function newBookingId(): string {
  for (;;) {
    const id = randomId();
    if (/\d/.test(id)) return id;
  }
}

export function findBookingId(text: string): string | null {
  const match = text
    .toUpperCase()
    .match(/(?<![A-Z0-9])[2-9A-HJ-NP-Z]{4}-?[2-9A-HJ-NP-Z]{4}(?![A-Z0-9])/g);
  const id = match?.map((m) => m.replace("-", "")).find((m) => /\d/.test(m));
  return id ?? null;
}

export function normalizeBookingId(raw: string): string | null {
  const id = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ID_PATTERN.test(id) && /\d/.test(id) ? id : null;
}

export function displayBookingId(id: string): string {
  return `${id.slice(0, 4)}-${id.slice(4)}`;
}

export async function busyIntervals(nowMs: number) {
  return db
    .select({
      id: schema.bookings.id,
      startAt: schema.bookings.startAt,
      endAt: schema.bookings.endAt,
    })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        gt(schema.bookings.endAt, nowMs - 3_600_000),
      ),
    );
}

export async function getBooking(id: string): Promise<Booking | null> {
  const [row] = await db
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.id, id));
  return row ?? null;
}

export async function lookupUpcoming(
  id: string,
  nowMs: number,
): Promise<Booking | null> {
  const row = await getBooking(id);
  return row && row.status === "confirmed" && row.startAt > nowMs ? row : null;
}

export type NewBooking = {
  id: string;
  patientName: string;
  phone: string;
  reason: string;
  startAt: number;
  endAt: number;
  sessionId: string;
};

export type WriteResult =
  | { ok: true; booking: Booking }
  | { ok: false; why: "slot_taken" | "phone_has_booking" | "not_found" };

export async function createBooking(
  input: NewBooking,
  bufferMinutes: number,
  nowMs: number,
): Promise<WriteResult> {
  const buffer = bufferMinutes * 60_000;
  // One statement, so the overlap check and the write cannot be interleaved with another booking.
  const result = await db.run(sql`
    INSERT INTO bookings (id, patient_name, phone, reason, start_at, end_at, status, session_id, created_at, updated_at)
    SELECT ${input.id}, ${input.patientName}, ${input.phone}, ${input.reason}, ${input.startAt}, ${input.endAt},
           'confirmed', ${input.sessionId}, ${nowMs}, ${nowMs}
    WHERE ${input.startAt} > ${nowMs}
      AND NOT EXISTS (SELECT 1 FROM bookings WHERE id = ${input.id})
      AND NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE status = 'confirmed' AND start_at < ${input.endAt + buffer} AND end_at > ${input.startAt - buffer})
      AND NOT EXISTS (
        SELECT 1 FROM bookings
        WHERE status = 'confirmed' AND phone = ${input.phone} AND start_at > ${nowMs})
  `);
  const row = await getBooking(input.id);
  if (row && row.sessionId === input.sessionId && row.startAt === input.startAt)
    return { ok: true, booking: row };
  if (result.rowsAffected > 0 && row) return { ok: true, booking: row };
  const [samePhone] = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        eq(schema.bookings.phone, input.phone),
        gt(schema.bookings.startAt, nowMs),
      ),
    );
  return { ok: false, why: samePhone ? "phone_has_booking" : "slot_taken" };
}

export async function cancelBooking(
  id: string,
  nowMs: number,
): Promise<WriteResult> {
  const result = await db.run(sql`
    UPDATE bookings SET status = 'cancelled', updated_at = ${nowMs}
    WHERE id = ${id} AND status = 'confirmed' AND start_at > ${nowMs}
  `);
  const row = await getBooking(id);
  if (result.rowsAffected > 0 && row) return { ok: true, booking: row };
  return { ok: false, why: "not_found" };
}

export async function rescheduleBooking(
  id: string,
  startAt: number,
  endAt: number,
  bufferMinutes: number,
  nowMs: number,
): Promise<WriteResult> {
  const buffer = bufferMinutes * 60_000;
  const result = await db.run(sql`
    UPDATE bookings SET start_at = ${startAt}, end_at = ${endAt}, updated_at = ${nowMs}
    WHERE id = ${id} AND status = 'confirmed' AND start_at > ${nowMs}
      AND NOT EXISTS (
        SELECT 1 FROM bookings AS other
        WHERE other.id <> ${id} AND other.status = 'confirmed'
          AND other.start_at < ${endAt + buffer} AND other.end_at > ${startAt - buffer})
  `);
  const row = await getBooking(id);
  if (row && row.status === "confirmed" && row.startAt === startAt)
    return { ok: true, booking: row };
  if (result.rowsAffected > 0 && row) return { ok: true, booking: row };
  return {
    ok: false,
    why:
      row && row.status === "confirmed" && row.startAt > nowMs
        ? "slot_taken"
        : "not_found",
  };
}

export async function phoneHasUpcoming(
  phone: string,
  nowMs: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "confirmed"),
        eq(schema.bookings.phone, phone),
        gt(schema.bookings.startAt, nowMs),
      ),
    );
  return Boolean(row);
}

export async function listBookings(): Promise<Booking[]> {
  return db
    .select()
    .from(schema.bookings)
    .orderBy(asc(schema.bookings.startAt));
}
