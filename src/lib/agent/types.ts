export type PartOfDay = "morning" | "afternoon" | "evening";

export type Draft = {
  date: string | null;
  minutes: number | null;
  partOfDay: PartOfDay | null;
  selectedStart: number | null;
  patientName: string | null;
  phone: string | null;
  reason: string | null;
  rescheduleOf: string | null;
};

export type Pending = {
  kind: "book" | "cancel" | "reschedule";
  bookingId: string;
  startAt: number;
  endAt: number;
  previousStartAt: number | null;
  patientName: string;
  phone: string;
  reason: string;
  createdTurn: number;
  createdAt: number;
};

export type LastAsked =
  | "none"
  | "pick_slot"
  | "name"
  | "phone"
  | "reason"
  | "confirm"
  | "booking_id";

export type SessionState = {
  turn: number;
  draft: Draft;
  offered: number[];
  pending: Pending | null;
  lastBookingId: string | null;
  lastAsked: LastAsked;
  awaitingIdFor: "cancel" | "reschedule" | null;
  strikes: number;
  idMisses: number;
};

export const emptyDraft = (): Draft => ({
  date: null,
  minutes: null,
  partOfDay: null,
  selectedStart: null,
  patientName: null,
  phone: null,
  reason: null,
  rescheduleOf: null,
});

export const emptyState = (): SessionState => ({
  turn: 0,
  draft: emptyDraft(),
  offered: [],
  pending: null,
  lastBookingId: null,
  lastAsked: "none",
  awaitingIdFor: null,
  strikes: 0,
  idMisses: 0,
});

export type Tap =
  | { kind: "slot"; startAt: number }
  | { kind: "confirm"; bookingId: string; startAt: number }
  | { kind: "change" };
export type TurnInput =
  | { type: "text"; text: string }
  | { type: "tap"; tap: Tap };

export type SummaryBlock = {
  type: "summary";
  kind: Pending["kind"];
  startAt: number;
  endAt: number;
  previousStartAt: number | null;
  patientName: string;
  phoneMasked: string;
  reason: string;
  bookingId: string | null;
  confirmToken: { bookingId: string; startAt: number };
};

export type Block =
  | { type: "text"; text: string }
  | { type: "slots"; slots: number[] }
  | { type: "picker"; date: string | null }
  | SummaryBlock
  | {
      type: "booked";
      kind: "booked" | "rescheduled";
      bookingId: string;
      startAt: number;
      endAt: number;
      patientName: string;
    }
  | { type: "cancelled"; bookingId: string; startAt: number }
  | { type: "contact"; phone: string };

export type StepStatus = "info" | "ok" | "blocked" | "error";
export type Step = {
  kind: "input" | "model" | "guard" | "tool" | "state";
  label: string;
  detail: string;
  status: StepStatus;
};

export type TurnRecord = {
  id: number;
  input: TurnInput;
  reply: Block[];
  steps: Step[];
  createdAt: number;
};
