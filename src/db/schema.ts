import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export type TimeRange = { start: string; end: string };
export type WeeklyHours = Record<
  "0" | "1" | "2" | "3" | "4" | "5" | "6",
  TimeRange[]
>;

export const clinic = sqliteTable("clinic", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  doctorName: text("doctor_name").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  fee: text("fee").notNull(),
  slotMinutes: integer("slot_minutes").notNull(),
  bufferMinutes: integer("buffer_minutes").notNull(),
  weeklyHours: text("weekly_hours", { mode: "json" })
    .$type<WeeklyHours>()
    .notNull(),
});

export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    patientName: text("patient_name").notNull(),
    phone: text("phone").notNull(),
    reason: text("reason").notNull(),
    startAt: integer("start_at").notNull(),
    endAt: integer("end_at").notNull(),
    status: text("status", { enum: ["confirmed", "cancelled"] }).notNull(),
    sessionId: text("session_id").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("bookings_start_idx").on(t.status, t.startAt),
    index("bookings_phone_idx").on(t.phone),
  ],
);

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  state: text("state", { mode: "json" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const turns = sqliteTable(
  "turns",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id").notNull(),
    input: text("input", { mode: "json" }).notNull(),
    reply: text("reply", { mode: "json" }).notNull(),
    steps: text("steps", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("turns_session_idx").on(t.sessionId, t.id)],
);
