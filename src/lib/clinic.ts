import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { WeeklyHours } from "@/db/schema";

export type Clinic = typeof schema.clinic.$inferSelect;

const WEEKDAY_HOURS = [
  { start: "10:00", end: "13:00" },
  { start: "17:00", end: "20:00" },
];

export const DEFAULT_CLINIC: Clinic = {
  id: 1,
  name: "Sunrise Clinic",
  doctorName: "Dr. Meera Rao",
  phone: "080 4567 8900",
  address: "14 Lake View Road, Indiranagar, Bengaluru",
  fee: "₹500 per consultation",
  slotMinutes: 15,
  bufferMinutes: 5,
  weeklyHours: {
    "0": [{ start: "10:00", end: "13:00" }],
    "1": WEEKDAY_HOURS,
    "2": WEEKDAY_HOURS,
    "3": WEEKDAY_HOURS,
    "4": WEEKDAY_HOURS,
    "5": WEEKDAY_HOURS,
    "6": WEEKDAY_HOURS,
  } satisfies WeeklyHours,
};

export async function getClinic(): Promise<Clinic> {
  const [row] = await db
    .select()
    .from(schema.clinic)
    .where(eq(schema.clinic.id, 1));
  if (row) return row;
  await db.insert(schema.clinic).values(DEFAULT_CLINIC).onConflictDoNothing();
  return DEFAULT_CLINIC;
}
