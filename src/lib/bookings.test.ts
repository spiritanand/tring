import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

process.env.TURSO_DATABASE_URL = `file:${join(mkdtempSync(join(tmpdir(), "tring-")), "test.db")}`;

const HOUR = 3_600_000;
const now = Date.UTC(2026, 10, 23, 4, 0);
const at = (hours: number, minutes = 0) =>
  now + hours * HOUR + minutes * 60_000;

let lib: typeof import("./bookings");

beforeAll(async () => {
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { db } = await import("@/db");
  await migrate(db, { migrationsFolder: "./drizzle" });
  lib = await import("./bookings");
});

const base = (id: string, phone: string, startAt: number) => ({
  id,
  patientName: "Asha",
  phone,
  reason: "fever",
  startAt,
  endAt: startAt + 15 * 60_000,
  sessionId: `s-${id}`,
});

describe("guarded booking writes", () => {
  it("books a free slot and refuses an overlap, including the buffer", async () => {
    expect(
      await lib.createBooking(base("AAAA2222", "9000000001", at(2)), 5, now),
    ).toMatchObject({ ok: true });
    expect(
      await lib.createBooking(base("BBBB2222", "9000000002", at(2)), 5, now),
    ).toEqual({
      ok: false,
      why: "slot_taken",
    });
    expect(
      await lib.createBooking(
        base("CCCC2222", "9000000003", at(2, 18)),
        5,
        now,
      ),
    ).toEqual({
      ok: false,
      why: "slot_taken",
    });
    expect(
      await lib.createBooking(
        base("DDDD2222", "9000000004", at(2, 20)),
        5,
        now,
      ),
    ).toMatchObject({ ok: true });
  });

  it("lets only one of two simultaneous confirmations win", async () => {
    const results = await Promise.all([
      lib.createBooking(base("EEEE2222", "9000000005", at(5)), 5, now),
      lib.createBooking(base("FFFF2222", "9000000006", at(5)), 5, now),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("treats a repeated confirm of the same booking as success, not a clash", async () => {
    const input = base("GGGG2222", "9000000007", at(6));
    expect(await lib.createBooking(input, 5, now)).toMatchObject({ ok: true });
    expect(await lib.createBooking(input, 5, now)).toMatchObject({
      ok: true,
      booking: { id: "GGGG2222" },
    });
    expect(
      (await lib.listBookings()).filter((b) => b.id === "GGGG2222"),
    ).toHaveLength(1);
  });

  it("allows one upcoming booking per phone number", async () => {
    expect(
      await lib.createBooking(base("HHHH2222", "9000000001", at(8)), 5, now),
    ).toEqual({
      ok: false,
      why: "phone_has_booking",
    });
  });

  it("reschedules onto a free slot, keeps the ID, and refuses a taken one", async () => {
    expect(
      await lib.rescheduleBooking("AAAA2222", at(2, 20), at(2, 35), 5, now),
    ).toEqual({
      ok: false,
      why: "slot_taken",
    });
    expect(
      await lib.rescheduleBooking("AAAA2222", at(3), at(3, 15), 5, now),
    ).toMatchObject({
      ok: true,
      booking: { id: "AAAA2222", startAt: at(3) },
    });
    expect(
      await lib.rescheduleBooking("AAAA2222", at(3, 5), at(3, 20), 5, now),
    ).toMatchObject({ ok: true });
  });

  it("cancels once, frees the slot and the phone number, and hides the booking from lookup", async () => {
    expect(await lib.cancelBooking("DDDD2222", now)).toMatchObject({
      ok: true,
      booking: { status: "cancelled" },
    });
    expect(await lib.cancelBooking("DDDD2222", now)).toEqual({
      ok: false,
      why: "not_found",
    });
    expect(await lib.lookupUpcoming("DDDD2222", now)).toBeNull();
    expect(
      await lib.createBooking(
        base("JJJJ2222", "9000000004", at(2, 20)),
        5,
        now,
      ),
    ).toMatchObject({ ok: true });
  });

  it("accepts booking IDs however they are typed and rejects malformed ones", () => {
    expect(lib.normalizeBookingId("k7qm-4txp")).toBe("K7QM4TXP");
    expect(lib.normalizeBookingId("K7QM 4TX")).toBeNull();
    expect(lib.normalizeBookingId("'; DROP TABLE bookings;--")).toBeNull();
    expect(lib.displayBookingId(lib.newBookingId())).toMatch(
      /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/,
    );
  });
});
