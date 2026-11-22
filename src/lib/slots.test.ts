import { describe, expect, it } from "vitest";
import type { WeeklyHours } from "@/db/schema";
import {
  checkSlot,
  freeSlotsOn,
  gridFor,
  nearestFree,
  resolveBareHour,
  type SlotConfig,
  snapToGrid,
} from "./slots";
import { fmtSlot, istDate, istMinutes, istToMs } from "./time";

const split = [
  { start: "10:00", end: "13:00" },
  { start: "17:00", end: "20:00" },
];
const weeklyHours: WeeklyHours = {
  "0": [],
  "1": split,
  "2": split,
  "3": split,
  "4": split,
  "5": split,
  "6": split,
};
const config: SlotConfig = { slotMinutes: 15, bufferMinutes: 5, weeklyHours };

// Monday 23 Nov 2026, 09:00 IST
const now = istToMs("2026-11-23", 9 * 60);

describe("IST conversion", () => {
  it("round-trips across the UTC date boundary", () => {
    const ms = istToMs("2026-11-23", 2 * 60);
    expect(new Date(ms).toISOString()).toBe("2026-11-22T20:30:00.000Z");
    expect(istDate(ms)).toBe("2026-11-23");
    expect(istMinutes(ms)).toBe(120);
    expect(fmtSlot(istToMs("2026-11-23", 17 * 60 + 20))).toBe(
      "Mon 23 Nov, 5:20 PM",
    );
  });
});

describe("grid", () => {
  it("steps by consult length plus buffer and never runs past closing", () => {
    const grid = gridFor("2026-11-23", config);
    expect(grid.slice(0, 3)).toEqual([600, 620, 640]);
    expect(grid.filter((m) => m < 780).at(-1)).toBe(760);
    expect(
      grid.every((m) => m + 15 <= 780 || (m >= 1020 && m + 15 <= 1200)),
    ).toBe(true);
  });

  it("is empty on a closed day", () => {
    expect(gridFor("2026-11-22", config)).toEqual([]);
  });
});

describe("availability", () => {
  const taken = {
    startAt: istToMs("2026-11-23", 1020),
    endAt: istToMs("2026-11-23", 1035),
  };

  it("reports why a time cannot be booked", () => {
    expect(checkSlot("2026-11-23", 1020, config, [], now)).toMatchObject({
      ok: true,
    });
    expect(checkSlot("2026-11-23", 1020, config, [taken], now)).toEqual({
      ok: false,
      problem: "taken",
    });
    expect(checkSlot("2026-11-23", 14 * 60, config, [], now)).toEqual({
      ok: false,
      problem: "outside_hours",
    });
    expect(checkSlot("2026-11-29", 600, config, [], now)).toEqual({
      ok: false,
      problem: "closed_day",
    });
    expect(checkSlot("2026-11-23", 8 * 60, config, [], now)).toEqual({
      ok: false,
      problem: "past",
    });
    expect(checkSlot("2026-11-20", 600, config, [], now)).toEqual({
      ok: false,
      problem: "past",
    });
    expect(checkSlot("2026-12-20", 600, config, [], now)).toEqual({
      ok: false,
      problem: "beyond_horizon",
    });
  });

  it("keeps the buffer clear around an off-grid booking made under older settings", () => {
    const odd = {
      startAt: istToMs("2026-11-23", 610),
      endAt: istToMs("2026-11-23", 640),
    };
    const free = freeSlotsOn("2026-11-23", config, [odd], now).map(istMinutes);
    expect(free).not.toContain(600);
    expect(free).not.toContain(620);
    expect(free).not.toContain(640);
    expect(free).toContain(660);
  });

  it("drops slots that have already started today", () => {
    const midMorning = istToMs("2026-11-23", 10 * 60 + 55);
    expect(
      freeSlotsOn("2026-11-23", config, [], midMorning).map(istMinutes)[0],
    ).toBe(680);
  });

  it("offers the nearest free times around a taken one, in order", () => {
    const free = freeSlotsOn("2026-11-23", config, [taken], now);
    expect(nearestFree(taken.startAt, free, 3).map(istMinutes)).toEqual([
      1040, 1060, 1080,
    ]);
  });
});

describe("time resolution", () => {
  it("reads a bare 5 as 5 PM when only the evening is open", () => {
    expect(resolveBareHour("2026-11-23", 5, 0, config)).toBe(17 * 60);
    expect(resolveBareHour("2026-11-23", 11, 0, config)).toBe(11 * 60);
  });

  it("snaps a near-miss onto the grid and rejects a far one", () => {
    expect(snapToGrid("2026-11-23", 17 * 60 + 5, config)).toBe(1020);
    expect(snapToGrid("2026-11-23", 15 * 60, config)).toBeNull();
  });
});
