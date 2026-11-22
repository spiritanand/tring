import {
  busyIntervals,
  cancelBooking,
  createBooking,
  displayBookingId,
  findBookingId,
  getBooking,
  lookupUpcoming,
  newBookingId,
  normalizeBookingId,
  phoneHasUpcoming,
  rescheduleBooking,
} from "@/lib/bookings";
import { type Clinic, getClinic } from "@/lib/clinic";
import {
  allFreeSlots,
  checkSlot,
  freeSlotsOn,
  HORIZON_DAYS,
  nearestFree,
  partOfDayWindow,
  resolveBareHour,
  type SlotProblem,
  snapToGrid,
} from "@/lib/slots";
import {
  fmtSlot,
  fmtTime,
  istDate,
  istMinutes,
  istToMs,
  upcomingDates,
} from "@/lib/time";
import type { ModelContext } from "./model";
import type { ParsedTurn } from "./schema";
import { loadSession, recordTurn, saveSession } from "./session";
import { t } from "./templates";
import {
  type Block,
  emptyDraft,
  type Pending,
  type SessionState,
  type Step,
  type SummaryBlock,
  type TurnInput,
  type TurnRecord,
} from "./types";
import {
  cleanName,
  cleanPhone,
  cleanReason,
  MAX_MESSAGE,
  maskPhone,
} from "./validate";

const PENDING_TTL_MS = 10 * 60_000;
const MAX_ID_MISSES = 5;
const MAX_STRIKES = 3;

export type Parser = (
  ctx: ModelContext,
) => Promise<{ parsed: ParsedTurn; ms: number }>;
export type TurnResult = { turn: TurnRecord; conflict: boolean };

type Busy = Awaited<ReturnType<typeof busyIntervals>>;
type When = Pick<
  ParsedTurn["fields"],
  "date" | "hour" | "minute" | "partOfDay"
>;

class Turn {
  blocks: Block[] = [];
  steps: Step[] = [];
  constructor(
    readonly sessionId: string,
    readonly state: SessionState,
    readonly clinic: Clinic,
    public busy: Busy,
    readonly nowMs: number,
  ) {}

  say(text: string) {
    this.blocks.push({ type: "text", text });
  }
  step(
    kind: Step["kind"],
    label: string,
    detail: string,
    status: Step["status"] = "info",
  ) {
    this.steps.push({ kind, label, detail, status });
  }

  get otherBusy(): Busy {
    const own = this.state.draft.rescheduleOf;
    return own ? this.busy.filter((b) => b.id !== own) : this.busy;
  }
  free(): number[] {
    return allFreeSlots(this.clinic, this.otherBusy, this.nowMs);
  }
  check(date: string, minutes: number) {
    return checkSlot(date, minutes, this.clinic, this.otherBusy, this.nowMs);
  }

  dropSlotPending() {
    if (this.state.pending && this.state.pending.kind !== "cancel") {
      this.state.pending = null;
      this.step(
        "state",
        "pending cleared",
        "details changed before confirmation",
      );
    }
  }

  offer(slots: number[], pickerDate: string | null) {
    this.state.offered = slots;
    this.state.lastAsked = "pick_slot";
    if (slots.length) this.blocks.push({ type: "slots", slots });
    this.blocks.push({ type: "picker", date: pickerDate });
    this.step(
      "state",
      "offered slots",
      slots.length ? slots.map(fmtSlot).join(" · ") : "none free",
      "info",
    );
  }

  offerNearest(targetMs: number, pickerDate: string | null) {
    const free = this.free();
    if (free.length === 0) {
      this.say(t.noSlots(this.clinic));
      this.state.offered = [];
      return;
    }
    this.say(t.nearest);
    this.offer(nearestFree(targetMs, free, 3), pickerDate);
  }

  offerEarliest(lead: string) {
    const free = this.free();
    this.step(
      "tool",
      "find_slots",
      `earliest free → ${free.length} in the next ${HORIZON_DAYS} days`,
      "ok",
    );
    if (free.length === 0) {
      this.say(t.noSlots(this.clinic));
      this.state.offered = [];
      return;
    }
    this.say(lead);
    this.offer(free.slice(0, 3), istDate(free[0]));
  }

  summary(pending: Pending): SummaryBlock {
    return {
      type: "summary",
      kind: pending.kind,
      startAt: pending.startAt,
      endAt: pending.endAt,
      previousStartAt: pending.previousStartAt,
      patientName: pending.patientName,
      phoneMasked: maskPhone(pending.phone),
      reason: pending.reason,
      bookingId: pending.kind === "book" ? null : pending.bookingId,
      confirmToken: { bookingId: pending.bookingId, startAt: pending.startAt },
    };
  }

  showSummary() {
    const pending = this.state.pending;
    if (!pending) return;
    this.say(
      pending.kind === "book"
        ? t.summaryBook
        : pending.kind === "cancel"
          ? t.summaryCancel
          : t.summaryReschedule,
    );
    this.blocks.push(this.summary(pending));
    this.state.lastAsked = "confirm";
  }

  setPending(pending: Omit<Pending, "createdTurn" | "createdAt">) {
    this.state.pending = {
      ...pending,
      createdTurn: this.state.turn,
      createdAt: this.nowMs,
    };
    this.step(
      "state",
      "pending set",
      `${pending.kind} ${fmtSlot(pending.startAt)} · waits for an explicit confirm on a later turn`,
      "ok",
    );
    this.showSummary();
  }

  problem(problem: SlotProblem, date: string, minutes: number | null) {
    this.say(t.problem(problem, date, minutes, this.clinic, this.nowMs));
  }

  resolveWhen(when: When) {
    const { state, clinic, nowMs } = this;
    const draft = state.draft;
    state.offered = [];
    draft.selectedStart = null;
    this.dropSlotPending();

    if (when.date === "past" || when.date === "beyond_horizon") {
      this.step(
        "guard",
        "date check",
        `BLOCKED · ${when.date === "past" ? "date is in the past" : "beyond the booking window"}`,
        "blocked",
      );
      if (when.date === "past") this.say(t.pastDate);
      else this.problem("beyond_horizon", istDate(nowMs), null);
      this.offerEarliest(t.offerEarliest(clinic));
      return;
    }

    const hourValid = when.hour !== null && when.hour >= 0 && when.hour <= 23;
    const minute =
      when.minute !== null && when.minute >= 0 && when.minute <= 59
        ? when.minute
        : 0;
    let date = when.date ?? null;

    if (hourValid && when.hour !== null) {
      let hour = when.hour;
      if (
        hour >= 1 &&
        hour <= 11 &&
        (when.partOfDay === "afternoon" || when.partOfDay === "evening")
      )
        hour += 12;
      const dates = upcomingDates(nowMs, HORIZON_DAYS);
      const minutesFor = (d: string) => {
        const resolved = when.partOfDay
          ? hour * 60 + minute
          : resolveBareHour(d, hour, minute, clinic);
        return snapToGrid(d, resolved, clinic) ?? resolved;
      };
      if (!date) {
        date =
          draft.date && dates.includes(draft.date)
            ? draft.date
            : (dates.find((d) => {
                const r = this.check(d, minutesFor(d));
                return r.ok || r.problem === "taken";
              }) ?? null);
      }
      if (!date) {
        const today = istDate(nowMs);
        this.step(
          "tool",
          "find_slots",
          `${fmtTime(minutesFor(today))} on any day → never inside clinic hours`,
          "blocked",
        );
        this.problem(
          "outside_hours",
          dates.find(
            (d) => freeSlotsOn(d, clinic, this.otherBusy, nowMs).length > 0,
          ) ?? today,
          minutesFor(today),
        );
        this.offerEarliest(t.offerEarliest(clinic));
        return;
      }
      const minutes = minutesFor(date);
      draft.date = date;
      const result = this.check(date, minutes);
      if (result.ok) {
        draft.selectedStart = result.startAt;
        this.step(
          "tool",
          "find_slots",
          `${fmtSlot(result.startAt)} → free`,
          "ok",
        );
        return;
      }
      this.step(
        "tool",
        "find_slots",
        `${fmtTime(minutes)} on ${date} → not bookable (${result.problem})`,
        "blocked",
      );
      this.problem(result.problem, date, minutes);
      this.offerNearest(
        istToMs(date, minutes),
        result.problem === "closed_day" ? null : date,
      );
      return;
    }

    const part = when.partOfDay ?? null;
    if (
      !date &&
      part &&
      draft.date &&
      upcomingDates(nowMs, HORIZON_DAYS).includes(draft.date)
    )
      date = draft.date;

    if (date) {
      draft.date = date;
      const [from, to] = part ? partOfDayWindow(part) : [0, 24 * 60];
      const dayFree = freeSlotsOn(date, clinic, this.otherBusy, nowMs);
      const inWindow = dayFree.filter(
        (s) => istMinutes(s) >= from && istMinutes(s) < to,
      );
      this.step(
        "tool",
        "find_slots",
        `${date}${part ? ` ${part}` : ""} → ${inWindow.length} free`,
        inWindow.length ? "ok" : "blocked",
      );
      if (inWindow.length) {
        this.say(part ? t.offerPart(date, part) : t.offerDay(date));
        this.offer(inWindow.slice(0, 3), date);
        return;
      }
      const probe = this.check(date, from);
      if (!probe.ok && probe.problem === "closed_day")
        this.problem("closed_day", date, null);
      else if (istToMs(date, to) <= nowMs)
        this.say(t.problem("past", date, null, clinic, nowMs));
      else
        this.say(
          part && dayFree.length ? t.partFull(date, part) : t.dayFull(date),
        );
      this.offerNearest(
        istToMs(date, part ? from : 12 * 60),
        dayFree.length ? date : null,
      );
      return;
    }

    if (part) {
      const [from, to] = partOfDayWindow(part);
      const matches = this.free().filter(
        (s) => istMinutes(s) >= from && istMinutes(s) < to,
      );
      this.step(
        "tool",
        "find_slots",
        `any day, ${part} → ${matches.length} free`,
        matches.length ? "ok" : "blocked",
      );
      if (matches.length) {
        this.say(t.offerPart(istDate(matches[0]), part));
        this.offer(matches.slice(0, 3), istDate(matches[0]));
        return;
      }
    }
    this.offerEarliest(t.offerEarliest(clinic));
  }

  async nextStep() {
    const { state, clinic, nowMs } = this;
    const draft = state.draft;

    if (draft.rescheduleOf) {
      const current = await lookupUpcoming(draft.rescheduleOf, nowMs);
      if (!current) {
        state.draft = emptyDraft();
        state.pending = null;
        this.step(
          "tool",
          "lookup_booking",
          "booking being moved is no longer active",
          "blocked",
        );
        this.say(t.idNotFound);
        return;
      }
      if (draft.selectedStart === null) {
        const still = state.offered.filter((s) => this.free().includes(s));
        if (still.length) {
          this.say(t.rescheduleWhen);
          this.offer(still, istDate(still[0]));
        } else this.offerEarliest(t.rescheduleWhen);
        return;
      }
      if (draft.selectedStart === current.startAt) {
        draft.selectedStart = null;
        this.say(t.sameTime);
        this.offer([], istDate(current.startAt));
        return;
      }
      if (!this.revalidateSelected(t.slotJustTakenMove)) return;
      this.setPending({
        kind: "reschedule",
        bookingId: current.id,
        startAt: draft.selectedStart,
        endAt: draft.selectedStart + clinic.slotMinutes * 60_000,
        previousStartAt: current.startAt,
        patientName: current.patientName,
        phone: current.phone,
        reason: current.reason,
      });
      return;
    }

    if (draft.selectedStart === null) {
      const free = this.free();
      const still = state.offered.filter((s) => free.includes(s));
      if (still.length) {
        this.say(
          "These times are still free. Tap one, or tell me a day and time.",
        );
        this.offer(still, istDate(still[0]));
      } else this.offerEarliest(t.offerEarliest(clinic));
      return;
    }

    if (!this.revalidateSelected(t.slotJustTaken)) return;

    if (!draft.patientName) {
      state.lastAsked = "name";
      this.say(`${fmtSlot(draft.selectedStart)} is free. ${t.askName}`);
      this.step("state", "needs", "patient name");
      return;
    }
    if (!draft.phone) {
      state.lastAsked = "phone";
      this.say(t.askPhone);
      this.step("state", "needs", "mobile number");
      return;
    }
    if (!draft.reason) {
      state.lastAsked = "reason";
      this.say(t.askReason);
      this.step("state", "needs", "reason for visit");
      return;
    }
    this.setPending({
      kind: "book",
      bookingId: newBookingId(),
      startAt: draft.selectedStart,
      endAt: draft.selectedStart + clinic.slotMinutes * 60_000,
      previousStartAt: null,
      patientName: draft.patientName,
      phone: draft.phone,
      reason: draft.reason,
    });
  }

  revalidateSelected(takenLine: string): boolean {
    const start = this.state.draft.selectedStart;
    if (start === null) return false;
    const result = this.check(istDate(start), istMinutes(start));
    if (result.ok) return true;
    this.state.draft.selectedStart = null;
    this.state.pending = null;
    this.step(
      "tool",
      "find_slots",
      `${fmtSlot(start)} → no longer bookable (${result.problem})`,
      "blocked",
    );
    if (result.problem === "taken") this.say(takenLine);
    else this.problem(result.problem, istDate(start), istMinutes(start));
    this.offerNearest(start, istDate(start));
    return false;
  }

  async reprise() {
    const { state } = this;
    const d = state.draft;
    if (state.pending) this.showSummary();
    else if (
      d.selectedStart !== null ||
      d.rescheduleOf ||
      d.patientName ||
      d.phone ||
      d.reason ||
      state.offered.length
    )
      await this.nextStep();
  }

  async mergePatient(
    fields: ParsedTurn["fields"],
    raw: string,
  ): Promise<boolean> {
    const { state, nowMs } = this;
    const draft = state.draft;
    const lowered = raw.toLowerCase();
    let changed = false;

    if (fields.patientName !== null) {
      const name = cleanName(fields.patientName);
      const typed =
        name
          ?.toLowerCase()
          .split(" ")
          .every((part) => lowered.includes(part)) ?? false;
      if (name && typed) {
        changed ||= draft.patientName !== name;
        draft.patientName = name;
      } else {
        this.step(
          "guard",
          "name check",
          "BLOCKED · not a plain name the patient typed",
          "blocked",
        );
        this.say(t.nameInvalid);
      }
    }

    if (fields.phone !== null || state.lastAsked === "phone") {
      const phone =
        cleanPhone(fields.phone ?? "") ??
        (state.lastAsked === "phone" ? cleanPhone(raw) : null);
      const typed = phone ? raw.replace(/\D/g, "").includes(phone) : false;
      if (phone && typed) {
        if (await phoneHasUpcoming(phone, nowMs)) {
          this.step(
            "guard",
            "phone check",
            "BLOCKED · this number already has an upcoming booking",
            "blocked",
          );
          draft.phone = null;
          state.lastAsked = "phone";
          this.say(t.phoneHasBooking);
          return true;
        }
        changed ||= draft.phone !== phone;
        draft.phone = phone;
      } else if (fields.phone !== null) {
        this.step(
          "guard",
          "phone check",
          "BLOCKED · not a valid 10-digit mobile number",
          "blocked",
        );
        this.say(t.phoneInvalid);
      }
    }

    const offered = fields.reason === null ? null : cleanReason(fields.reason);
    const copied =
      offered && lowered.replace(/\s+/g, " ").includes(offered.toLowerCase())
        ? offered
        : null;
    const reason =
      copied ??
      (state.lastAsked === "reason" && draft.selectedStart !== null
        ? cleanReason(raw)
        : null);
    if (reason) {
      changed ||= draft.reason !== reason;
      draft.reason = reason;
    }

    if (changed) this.dropSlotPending();
    return false;
  }

  async resolveId(
    raw: string,
    modelId: string | null,
  ): Promise<string | "ask" | "locked" | "miss"> {
    const { state, nowMs } = this;
    if (state.idMisses >= MAX_ID_MISSES) return "locked";
    const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const fromModel = modelId ? normalizeBookingId(modelId) : null;
    const typed =
      findBookingId(raw) ??
      (fromModel && stripped.includes(fromModel) ? fromModel : null);
    if (typed) {
      const found = await lookupUpcoming(typed, nowMs);
      this.step(
        "tool",
        "lookup_booking",
        `${displayBookingId(typed)} → ${found ? "active booking found" : "no active booking"}`,
        found ? "ok" : "blocked",
      );
      if (found) return found.id;
      state.idMisses += 1;
      return state.idMisses >= MAX_ID_MISSES ? "locked" : "miss";
    }
    if (state.lastBookingId) {
      const own = await lookupUpcoming(state.lastBookingId, nowMs);
      if (own) {
        this.step(
          "tool",
          "lookup_booking",
          "booking made earlier in this session → active",
          "ok",
        );
        return own.id;
      }
      state.lastBookingId = null;
    }
    return "ask";
  }

  async startCancelOrMove(
    kind: "cancel" | "reschedule",
    raw: string,
    parsed: ParsedTurn,
  ) {
    const { state, clinic } = this;
    const id = await this.resolveId(raw, parsed.fields.bookingId);
    if (id === "locked") {
      state.awaitingIdFor = null;
      this.step(
        "guard",
        "lookup limit",
        `BLOCKED · ${MAX_ID_MISSES} wrong booking IDs in this session`,
        "blocked",
      );
      this.say(t.idLocked(clinic));
      this.blocks.push({ type: "contact", phone: clinic.phone });
      return;
    }
    if (id === "miss") {
      state.awaitingIdFor = kind;
      state.lastAsked = "booking_id";
      this.say(t.idNotFound);
      return;
    }
    if (id === "ask") {
      state.awaitingIdFor = kind;
      state.lastAsked = "booking_id";
      this.say(t.askBookingId);
      this.step("state", "needs", "booking ID");
      return;
    }
    state.awaitingIdFor = null;
    const booking = await getBooking(id);
    if (!booking) return;
    if (kind === "cancel") {
      state.draft = emptyDraft();
      state.offered = [];
      this.setPending({
        kind: "cancel",
        bookingId: booking.id,
        startAt: booking.startAt,
        endAt: booking.endAt,
        previousStartAt: null,
        patientName: booking.patientName,
        phone: booking.phone,
        reason: booking.reason,
      });
      return;
    }
    state.draft = { ...emptyDraft(), rescheduleOf: booking.id };
    state.offered = [];
    state.pending = null;
    this.step(
      "state",
      "reschedule started",
      `moving ${displayBookingId(booking.id)} from ${fmtSlot(booking.startAt)}`,
      "ok",
    );
    const f = parsed.fields;
    if (f.date !== null || f.hour !== null || f.partOfDay !== null) {
      this.resolveWhen(f);
      if (state.draft.selectedStart !== null) await this.nextStep();
      return;
    }
    this.say(`Your appointment is on ${fmtSlot(booking.startAt)}.`);
    await this.nextStep();
  }

  async execute() {
    const { state, clinic, nowMs, sessionId } = this;
    const pending = state.pending;
    if (!pending) return;
    if (pending.kind === "book") {
      const result = await createBooking(
        {
          id: pending.bookingId,
          patientName: pending.patientName,
          phone: pending.phone,
          reason: pending.reason,
          startAt: pending.startAt,
          endAt: pending.endAt,
          sessionId,
        },
        clinic.bufferMinutes,
        nowMs,
      );
      if (result.ok) {
        this.step(
          "tool",
          "create_booking",
          `${displayBookingId(result.booking.id)} written · ${fmtSlot(result.booking.startAt)}`,
          "ok",
        );
        state.lastBookingId = result.booking.id;
        this.finishFlow();
        this.say(t.booked);
        this.blocks.push({
          type: "booked",
          kind: "booked",
          bookingId: result.booking.id,
          startAt: result.booking.startAt,
          endAt: result.booking.endAt,
          patientName: result.booking.patientName,
        });
        return;
      }
      this.step(
        "tool",
        "create_booking",
        `refused by the database guard · ${result.why}`,
        "blocked",
      );
      state.pending = null;
      if (result.why === "phone_has_booking") {
        state.draft.phone = null;
        state.lastAsked = "phone";
        this.say(t.phoneHasBooking);
        return;
      }
      state.draft.selectedStart = null;
      this.busy = await busyIntervals(nowMs);
      this.say(t.slotJustTaken);
      this.offerNearest(pending.startAt, istDate(pending.startAt));
      return;
    }

    if (pending.kind === "cancel") {
      const result = await cancelBooking(pending.bookingId, nowMs);
      const row = result.ok
        ? result.booking
        : await getBooking(pending.bookingId);
      const done = row?.status === "cancelled";
      this.step(
        "tool",
        "cancel_booking",
        `${displayBookingId(pending.bookingId)} → ${done ? "cancelled" : "no active booking"}`,
        done ? "ok" : "blocked",
      );
      if (state.lastBookingId === pending.bookingId) state.lastBookingId = null;
      this.finishFlow();
      if (done && row) {
        this.say(t.cancelled);
        this.blocks.push({
          type: "cancelled",
          bookingId: row.id,
          startAt: row.startAt,
        });
      } else this.say(t.idNotFound);
      return;
    }

    const result = await rescheduleBooking(
      pending.bookingId,
      pending.startAt,
      pending.endAt,
      clinic.bufferMinutes,
      nowMs,
    );
    if (result.ok) {
      this.step(
        "tool",
        "reschedule_booking",
        `${displayBookingId(result.booking.id)} moved to ${fmtSlot(result.booking.startAt)}`,
        "ok",
      );
      this.finishFlow();
      this.say(t.rescheduled);
      this.blocks.push({
        type: "booked",
        kind: "rescheduled",
        bookingId: result.booking.id,
        startAt: result.booking.startAt,
        endAt: result.booking.endAt,
        patientName: result.booking.patientName,
      });
      return;
    }
    this.step(
      "tool",
      "reschedule_booking",
      `refused by the database guard · ${result.why}`,
      "blocked",
    );
    state.pending = null;
    if (result.why === "not_found") {
      this.finishFlow();
      this.say(t.idNotFound);
      return;
    }
    state.draft.selectedStart = null;
    this.busy = await busyIntervals(nowMs);
    this.say(t.slotJustTakenMove);
    this.offerNearest(pending.startAt, istDate(pending.startAt));
  }

  finishFlow() {
    this.state.draft = emptyDraft();
    this.state.offered = [];
    this.state.pending = null;
    this.state.awaitingIdFor = null;
    this.state.lastAsked = "none";
    this.step("state", "flow finished", "draft and pending cleared");
  }

  async confirm(tap: { bookingId: string; startAt: number } | null) {
    const { state, nowMs } = this;
    const pending = state.pending;
    if (!pending) {
      if (tap) {
        const row = await getBooking(tap.bookingId);
        if (
          row &&
          row.sessionId === this.sessionId &&
          row.status === "confirmed" &&
          row.startAt === tap.startAt
        ) {
          this.step(
            "guard",
            "confirm",
            "already done · showing the existing booking",
            "ok",
          );
          this.blocks.push({
            type: "booked",
            kind: "booked",
            bookingId: row.id,
            startAt: row.startAt,
            endAt: row.endAt,
            patientName: row.patientName,
          });
          return;
        }
      }
      this.step(
        "guard",
        "confirm",
        "BLOCKED · nothing is waiting for confirmation",
        "blocked",
      );
      this.say(t.nothingToConfirm);
      await this.reprise();
      return;
    }
    if (
      tap &&
      (tap.bookingId !== pending.bookingId || tap.startAt !== pending.startAt)
    ) {
      this.step(
        "guard",
        "confirm",
        "BLOCKED · that button belongs to an older summary",
        "blocked",
      );
      this.showSummary();
      return;
    }
    if (pending.createdTurn >= state.turn) {
      this.step(
        "guard",
        "confirm",
        "BLOCKED · a summary cannot be confirmed on the turn that created it",
        "blocked",
      );
      this.showSummary();
      return;
    }
    if (nowMs - pending.createdAt > PENDING_TTL_MS) {
      this.step(
        "guard",
        "confirm",
        "BLOCKED · summary older than 10 minutes",
        "blocked",
      );
      state.pending = null;
      this.say(t.expired);
      await this.reprise();
      return;
    }
    this.step(
      "guard",
      "confirm",
      "ALLOWED · explicit confirm of a summary shown on an earlier turn",
      "ok",
    );
    await this.execute();
  }

  async decline(viaButton: boolean) {
    const { state, nowMs } = this;
    const pending = state.pending;
    const moving = state.draft.rescheduleOf;
    if (pending) {
      state.pending = null;
      state.draft.selectedStart = null;
      this.step("state", "pending cleared", "patient declined", "ok");
      if (pending.kind === "cancel") {
        this.say(t.declinedCancel);
        state.lastAsked = "none";
        return;
      }
      if (pending.kind === "reschedule" && !viaButton) {
        state.draft = emptyDraft();
        state.offered = [];
        this.say(t.keptOriginal);
        state.lastAsked = "none";
        return;
      }
      this.say(
        pending.kind === "reschedule" ? t.declinedReschedule : t.declinedBook,
      );
      this.offer([], istDate(pending.startAt));
      return;
    }
    state.draft = emptyDraft();
    state.offered = [];
    state.awaitingIdFor = null;
    state.lastAsked = "none";
    if (moving && (await lookupUpcoming(moving, nowMs)))
      this.say(t.keptOriginal);
    else this.say(t.nothingInProgress);
  }

  async selectSlot(startAt: number) {
    const { state } = this;
    const result = this.check(istDate(startAt), istMinutes(startAt));
    if (!result.ok) {
      this.step(
        "guard",
        "slot check",
        `BLOCKED · ${fmtSlot(startAt)} is not bookable (${result.problem})`,
        "blocked",
      );
      state.draft.selectedStart = null;
      this.dropSlotPending();
      this.problem(result.problem, istDate(startAt), istMinutes(startAt));
      this.offerNearest(startAt, istDate(startAt));
      return;
    }
    this.step(
      "guard",
      "slot check",
      `ALLOWED · ${fmtSlot(startAt)} is free`,
      "ok",
    );
    this.dropSlotPending();
    state.draft.selectedStart = result.startAt;
    state.draft.date = istDate(result.startAt);
    await this.nextStep();
  }
}

function hasWhen(f: ParsedTurn["fields"]): boolean {
  return f.date !== null || f.hour !== null || f.partOfDay !== null;
}

function describeFields(parsed: ParsedTurn): string {
  const f = parsed.fields;
  const parts: string[] = [];
  if (f.date) parts.push(`date=${f.date}`);
  if (f.hour !== null)
    parts.push(
      `time=${String(f.hour).padStart(2, "0")}:${String(f.minute ?? 0).padStart(2, "0")}`,
    );
  if (f.partOfDay) parts.push(`part=${f.partOfDay}`);
  if (f.patientName) parts.push(`name=${f.patientName.slice(0, 40)}`);
  if (f.phone)
    parts.push(
      `phone=${maskPhone(f.phone.replace(/\D/g, "").slice(-10).padStart(10, "•"))}`,
    );
  if (f.reason) parts.push("reason=given");
  if (f.bookingId) parts.push("bookingId=given");
  if (parsed.offeredSlot !== null) parts.push(`slot=#${parsed.offeredSlot}`);
  if (parsed.faqTopic) parts.push(`topic=${parsed.faqTopic}`);
  return parts.length ? parts.join(" · ") : "no fields";
}

async function handleText(turn: Turn, raw: string, parse: Parser) {
  const { state, clinic, nowMs } = turn;
  const dates = upcomingDates(nowMs, HORIZON_DAYS);
  const pending = state.pending;
  const mode = pending ? "awaiting_confirm" : "open";

  let parsed: ParsedTurn;
  try {
    const result = await parse({
      nowMs,
      dates,
      mode,
      have: {
        slot: state.draft.selectedStart !== null,
        name: Boolean(state.draft.patientName),
        phone: Boolean(state.draft.phone),
        reason: Boolean(state.draft.reason),
      },
      offered: state.offered.map(fmtSlot),
      pending: pending ? `${pending.kind} ${fmtSlot(pending.startAt)}` : null,
      lastAsked: state.lastAsked,
      rescheduling: Boolean(state.draft.rescheduleOf),
      message: raw,
    });
    parsed = result.parsed;
    turn.step(
      "model",
      `action: ${parsed.action}`,
      `${describeFields(parsed)} · ${result.ms} ms`,
      "ok",
    );
  } catch (error) {
    turn.step(
      "model",
      "parse failed",
      error instanceof Error ? error.name : "unknown error",
      "error",
    );
    turn.say(t.modelFailed);
    return false;
  }

  let action = parsed.action;
  const f = parsed.fields;
  const typedId = findBookingId(raw);

  if (
    state.awaitingIdFor &&
    typedId &&
    action !== "decline" &&
    action !== "answer_faq"
  )
    action = state.awaitingIdFor;
  if (mode === "awaiting_confirm" && pending) {
    const carriesDetail =
      hasWhen(f) ||
      f.patientName !== null ||
      f.phone !== null ||
      f.reason !== null;
    if (action === "confirm" && hasWhen(f)) action = "book";
    else if (action === "book" && !carriesDetail && pending.kind !== "cancel")
      action = "confirm";
    else if (action === "cancel" && !typedId)
      action = pending.kind === "cancel" ? "confirm" : "decline";
    else if (action === "reschedule" && !typedId && pending.kind !== "cancel")
      action = "book";
  }
  if (action !== parsed.action)
    turn.step(
      "guard",
      "action adjusted",
      `${parsed.action} → ${action} given what is pending`,
      "info",
    );
  turn.step(
    "guard",
    "mode",
    `${mode} · ${action} is handled by code, not by the model`,
    "info",
  );

  if (action !== "none") state.strikes = 0;

  switch (action) {
    case "confirm":
      await turn.confirm(null);
      break;
    case "decline":
      await turn.decline(false);
      break;
    case "cancel":
      await turn.startCancelOrMove("cancel", raw, parsed);
      break;
    case "reschedule":
      await turn.startCancelOrMove("reschedule", raw, parsed);
      break;
    case "select_slot": {
      const index = parsed.offeredSlot;
      const start = index !== null ? state.offered[index - 1] : undefined;
      if (start !== undefined) {
        await turn.selectSlot(start);
        break;
      }
      if (hasWhen(f)) turn.resolveWhen(f);
      if (!hasWhen(f) || state.draft.selectedStart !== null)
        await turn.nextStep();
      break;
    }
    case "book": {
      if (pending?.kind === "cancel") {
        state.pending = null;
        turn.step(
          "state",
          "pending cleared",
          "patient moved on from the cancellation",
        );
      }
      const stop = state.draft.rescheduleOf
        ? false
        : await turn.mergePatient(f, raw);
      if (stop) break;
      if (hasWhen(f)) {
        turn.resolveWhen(f);
        if (state.draft.selectedStart === null) break;
      }
      await turn.nextStep();
      break;
    }
    case "answer_faq": {
      const topic = parsed.faqTopic ?? "other";
      turn.step(
        "tool",
        "clinic_fact",
        `topic=${topic} → stored clinic text`,
        "ok",
      );
      turn.say(t.faq(topic, clinic));
      await turn.reprise();
      break;
    }
    default: {
      state.strikes += 1;
      turn.step(
        "guard",
        "off topic",
        `strike ${state.strikes} of ${MAX_STRIKES} · no action taken`,
        "blocked",
      );
      if (state.strikes >= MAX_STRIKES) {
        state.strikes = 0;
        turn.say(t.cantHelp(clinic));
        turn.blocks.push({ type: "contact", phone: clinic.phone });
      } else turn.say(t.canDo(clinic));
      await turn.reprise();
    }
  }
  return true;
}

export async function runTurn(
  sessionId: string,
  input: TurnInput,
  parse: Parser,
  nowMs = Date.now(),
): Promise<TurnResult> {
  const steps: Step[] = [];
  let blocks: Block[] = [];
  let conflict = false;

  steps.push({
    kind: "input",
    label:
      input.type === "text" ? "typed message" : `button: ${input.tap.kind}`,
    detail:
      input.type === "text"
        ? `${input.text.length} characters · sent to the model as untrusted data`
        : "handled by code · no model call",
    status: "info",
  });

  try {
    const [{ state, version }, clinic, busy] = await Promise.all([
      loadSession(sessionId),
      getClinic(),
      busyIntervals(nowMs),
    ]);
    const turn = new Turn(
      sessionId,
      structuredClone(state),
      clinic,
      busy,
      nowMs,
    );
    turn.steps = steps;
    turn.state.turn += 1;
    let changed = true;

    if (input.type === "text") {
      const raw = input.text.trim();
      if (raw.length > MAX_MESSAGE) {
        turn.step(
          "guard",
          "length check",
          `BLOCKED · over ${MAX_MESSAGE} characters, not sent to the model`,
          "blocked",
        );
        turn.say(t.tooLong);
        changed = false;
      } else changed = await handleText(turn, raw, parse);
    } else if (input.tap.kind === "slot") {
      turn.state.strikes = 0;
      await turn.selectSlot(input.tap.startAt);
    } else if (input.tap.kind === "confirm") {
      await turn.confirm({
        bookingId: input.tap.bookingId,
        startAt: input.tap.startAt,
      });
    } else {
      await turn.decline(true);
    }

    blocks = turn.blocks;
    if (changed) {
      const saved = await saveSession(sessionId, turn.state, version, nowMs);
      if (!saved) {
        conflict = true;
        blocks = [];
      }
    }
  } catch (error) {
    console.error("turn failed", error);
    steps.push({
      kind: "tool",
      label: "database",
      detail: "the operation failed · session left unchanged",
      status: "error",
    });
    blocks = [{ type: "text", text: t.dbFailed }];
  }

  if (conflict)
    return {
      turn: { id: 0, input, reply: [], steps, createdAt: nowMs },
      conflict: true,
    };
  try {
    return {
      turn: await recordTurn(sessionId, {
        input,
        reply: blocks,
        steps,
        createdAt: nowMs,
      }),
      conflict: false,
    };
  } catch (error) {
    console.error("turn not recorded", error);
    return {
      turn: { id: 0, input, reply: blocks, steps, createdAt: nowMs },
      conflict: false,
    };
  }
}
