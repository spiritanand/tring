import type { Booking } from "./bookings";
import { displayBookingId } from "./bookings";
import type { Clinic } from "./clinic";

const escapeText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/[\r\n]+/g, " ")
    .replace(/;/g, ";")
    .replace(/,/g, "\\,");

const stamp = (ms: number) =>
  `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;

// Reason and phone are left out: the file leaves the app, and the booking ID is all the patient needs.
export function bookingIcs(
  booking: Booking,
  clinic: Clinic,
  nowMs: number,
): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tring//Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${booking.id}@tring`,
    `DTSTAMP:${stamp(nowMs)}`,
    `DTSTART:${stamp(booking.startAt)}`,
    `DTEND:${stamp(booking.endAt)}`,
    `SUMMARY:${escapeText(`Appointment with ${clinic.doctorName}`)}`,
    `LOCATION:${escapeText(`${clinic.name}, ${clinic.address}`)}`,
    `DESCRIPTION:${escapeText(`Booking ID ${displayBookingId(booking.id)}. Use it in the Tring chat to reschedule or cancel. Clinic phone ${clinic.phone}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}
