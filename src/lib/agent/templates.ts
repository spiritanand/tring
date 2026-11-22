import type { Clinic } from "@/lib/clinic";
import { HORIZON_DAYS, type SlotProblem } from "@/lib/slots";
import {
  addDays,
  fmtDate,
  fmtTime,
  istDate,
  parseHHMM,
  weekdayOf,
} from "@/lib/time";
import type { FaqTopic } from "./schema";
import type { PartOfDay } from "./types";

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export function hoursOn(clinic: Clinic, date: string): string {
  const ranges =
    clinic.weeklyHours[
      String(weekdayOf(date)) as keyof Clinic["weeklyHours"]
    ] ?? [];
  if (ranges.length === 0) return "closed";
  return ranges
    .map(
      (r) => `${fmtTime(parseHHMM(r.start))} to ${fmtTime(parseHHMM(r.end))}`,
    )
    .join(" and ");
}

export function weekHours(clinic: Clinic): string {
  return DAYS.map((day, i) => {
    const ranges =
      clinic.weeklyHours[String(i) as keyof Clinic["weeklyHours"]] ?? [];
    const text = ranges.length
      ? ranges
          .map(
            (r) =>
              `${fmtTime(parseHHMM(r.start))} to ${fmtTime(parseHHMM(r.end))}`,
          )
          .join(", ")
      : "closed";
    return `${day.slice(0, 3)}: ${text}`;
  }).join("\n");
}

export const t = {
  offerEarliest: (clinic: Clinic) =>
    `Here are the earliest times with ${clinic.doctorName}. Tap one, pick a day below, or tell me a day and time.`,
  offerDay: (date: string) => `${fmtDate(date)} has these times free.`,
  offerPart: (date: string, part: PartOfDay) =>
    `These ${part} times are free on ${fmtDate(date)}.`,
  offerAtTime: (minutes: number) =>
    `${fmtTime(minutes)} is free on these days.`,
  nearest: "These are the nearest free times.",
  noSlots: (clinic: Clinic) =>
    `There are no free times in the next ${HORIZON_DAYS} days. Please call the clinic on ${clinic.phone}.`,
  problem: (
    problem: SlotProblem,
    date: string,
    minutes: number | null,
    clinic: Clinic,
    nowMs: number,
  ): string => {
    const when =
      minutes === null
        ? fmtDate(date)
        : `${fmtTime(minutes)} on ${fmtDate(date)}`;
    if (problem === "past") return `${when} has already passed.`;
    if (problem === "beyond_horizon")
      return `I can only book up to ${HORIZON_DAYS} days ahead, until ${fmtDate(addDays(istDate(nowMs), HORIZON_DAYS - 1))}.`;
    if (problem === "closed_day")
      return `The clinic is closed on ${fmtDate(date)}.`;
    if (problem === "outside_hours")
      return `${when} is outside clinic hours. That day we are open ${hoursOn(clinic, date)}.`;
    return `${when} is already taken.`;
  },
  dayFull: (date: string) => `${fmtDate(date)} is fully booked.`,
  partFull: (date: string, part: PartOfDay) =>
    `There are no free ${part} times on ${fmtDate(date)}.`,
  pastDate: "That date has already passed.",
  askName: "What name should I book this under?",
  askPhone: "And a mobile number the clinic can reach you on?",
  askReason: "What is the visit for? A few words is enough.",
  nameInvalid: "Please give the name in letters only.",
  phoneInvalid:
    "That doesn't look like a 10-digit Indian mobile number. Please send it again.",
  summaryBook: "Please check the details. Nothing is booked until you confirm.",
  summaryCancel:
    "Do you want to cancel this appointment? Nothing changes until you confirm.",
  summaryReschedule:
    "Please check the new time. Nothing changes until you confirm.",
  booked:
    "You're booked. Keep your booking ID: you need it to reschedule or cancel.",
  rescheduled:
    "Done. Your appointment has moved. Your booking ID stays the same.",
  cancelled: "Your appointment is cancelled.",
  nothingToConfirm: "There is nothing waiting to be confirmed yet.",
  expired: "That summary has expired, so nothing was changed.",
  declinedBook:
    "No problem, nothing was booked. Pick another time below, or tell me what to change.",
  declinedReschedule:
    "No problem, your appointment has not moved. Pick another time below, or say keep it.",
  declinedCancel: "Okay, your appointment stays as it is.",
  keptOriginal: "Okay, your appointment stays at its current time.",
  sameTime:
    "That is the time you already have. Pick a different one to move it.",
  nothingInProgress:
    "Okay. Tell me if you would like to book, move or cancel an appointment.",
  askBookingId:
    "Which appointment? Please send the booking ID from your confirmation, for example K7QM-4TXP.",
  idNotFound:
    "I can't find an active booking with that ID. Please check it and send it again.",
  idLocked: (clinic: Clinic) =>
    `Too many booking IDs didn't match, so I can't look up any more here. Please call the clinic on ${clinic.phone}.`,
  phoneHasBooking:
    "That mobile number already has an upcoming appointment. To move or cancel it, send its booking ID. Otherwise give a different number.",
  slotJustTaken:
    "That time was just taken by someone else. Nothing was booked.",
  slotJustTakenMove:
    "That time was just taken by someone else. Your appointment has not moved.",
  rescheduleWhen:
    "When would you like to move it to? Pick a time below, or tell me a day and time.",
  canDo: (clinic: Clinic) =>
    `I can book, move or cancel an appointment with ${clinic.doctorName} at ${clinic.name}, and tell you our fees, hours and address.`,
  cantHelp: (clinic: Clinic) =>
    `I can't help with that here. For anything else, please call the clinic on ${clinic.phone}.`,
  modelFailed:
    "I couldn't read that, and nothing was changed. Please try again, or use the buttons.",
  dbFailed:
    "Something went wrong on our side. Nothing was booked or changed. Please try again in a moment.",
  tooLong:
    "That message is too long for me. Please keep it under 500 characters.",
  faq: (topic: FaqTopic, clinic: Clinic): string => {
    if (topic === "fees") return `The consultation fee is ${clinic.fee}.`;
    if (topic === "address") return `${clinic.name} is at ${clinic.address}.`;
    if (topic === "hours") return `Clinic hours:\n${weekHours(clinic)}`;
    if (topic === "doctor")
      return `Appointments are with ${clinic.doctorName}.`;
    return t.canDo(clinic);
  },
};
