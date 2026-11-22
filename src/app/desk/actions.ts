"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, schema } from "@/db";
import { DEFAULT_CLINIC, getClinic } from "@/lib/clinic";
import { parseHHMM } from "@/lib/time";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const day = z
  .array(z.object({ start: time, end: time }))
  .max(3)
  .refine(
    (ranges) => {
      const sorted = [...ranges].sort(
        (a, b) => parseHHMM(a.start) - parseHHMM(b.start),
      );
      return sorted.every(
        (r, i) =>
          parseHHMM(r.start) < parseHHMM(r.end) &&
          (i === 0 || parseHHMM(sorted[i - 1].end) <= parseHHMM(r.start)),
      );
    },
    {
      message:
        "Each range needs a start before its end, and ranges on one day must not overlap.",
    },
  );

const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(2)
    .max(max)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
    .regex(/^[^\u0000-\u001f<>]*$/, "Plain text only.");

const settingsSchema = z.object({
  name: plain(60),
  doctorName: plain(60),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ ()-]{6,20}$/, "Digits, spaces and + ( ) - only."),
  address: plain(160),
  fee: plain(60),
  slotMinutes: z.union([z.literal(15), z.literal(20), z.literal(30)]),
  bufferMinutes: z.union([
    z.literal(0),
    z.literal(5),
    z.literal(10),
    z.literal(15),
  ]),
  weeklyHours: z.object({
    "0": day,
    "1": day,
    "2": day,
    "3": day,
    "4": day,
    "5": day,
    "6": day,
  }),
});

export type SettingsInput = z.infer<typeof settingsSchema>;
export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveSettings(input: SettingsInput): Promise<SaveResult> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: `${issue.path.join(" › ") || "Settings"}: ${issue.message}`,
    };
  }
  const weeklyHours = Object.fromEntries(
    Object.entries(parsed.data.weeklyHours).map(([key, ranges]) => [
      key,
      [...ranges].sort((a, b) => parseHHMM(a.start) - parseHHMM(b.start)),
    ]),
  ) as SettingsInput["weeklyHours"];
  await getClinic();
  await db
    .update(schema.clinic)
    .set({ ...parsed.data, weeklyHours })
    .where(eq(schema.clinic.id, 1));
  revalidatePath("/desk");
  return { ok: true };
}

export async function resetDemoData(): Promise<void> {
  await db.delete(schema.turns);
  await db.delete(schema.sessions);
  await db.delete(schema.bookings);
  await getClinic();
  const { id: _id, ...defaults } = DEFAULT_CLINIC;
  await db.update(schema.clinic).set(defaults).where(eq(schema.clinic.id, 1));
  revalidatePath("/desk");
}
