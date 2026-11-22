import { z } from "zod";

export const ACTIONS = [
  "book",
  "select_slot",
  "confirm",
  "decline",
  "cancel",
  "reschedule",
  "answer_faq",
  "none",
] as const;
export type Action = (typeof ACTIONS)[number];

export const FAQ_TOPICS = [
  "fees",
  "address",
  "hours",
  "doctor",
  "other",
] as const;
export type FaqTopic = (typeof FAQ_TOPICS)[number];

export function turnSchema(dates: string[]) {
  return z.object({
    action: z.enum(ACTIONS),
    fields: z.object({
      date: z.enum([...dates, "past", "beyond_horizon"]).nullable(),
      hour: z.number().int().nullable(),
      minute: z.number().int().nullable(),
      partOfDay: z.enum(["morning", "afternoon", "evening"]).nullable(),
      patientName: z.string().nullable(),
      phone: z.string().nullable(),
      reason: z.string().nullable(),
      bookingId: z.string().nullable(),
    }),
    offeredSlot: z.number().int().nullable(),
    faqTopic: z.enum(FAQ_TOPICS).nullable(),
  });
}

export type ParsedTurn = z.infer<ReturnType<typeof turnSchema>>;
