# Tring — design spec

Tring is a chat agent that books, cancels and reschedules appointments for one single-doctor clinic. It is a hackathon build (solo, about five hours in total) for the brief "build an agent that takes a real task from start to finish using at least one tool, then defend it against bad input". Judging: usefulness 30, agent design 25, unbreakable 25, demo and clarity 20. Strangers will open it on their phones and try to break it.

## Product

- **Patient side (`/`)**: a web chat with no login. The patient gives a name, a phone number and a reason for visit, picks a free slot, confirms, and receives a booking ID and an "Add to calendar" `.ics` download. The booking ID alone later unlocks cancel and reschedule.
- **Clinic side (`/desk`)**: no login and no passcode (owner's decision), and linked from the header of both pages so that anyone trying the demo can reach it. It has a read-only table of all bookings (time, patient, phone, reason, status), a settings form, a "reset demo data" button that also restores the seeded settings, and a QR code for the patient link.
- **Settings**: weekly hours as a toggle plus one or more time ranges per weekday (a second range gives a lunch break), consult length (15/20/30 minutes), buffer between appointments (0/5/10/15 minutes), doctor name, clinic name, phone, address and fee. Changing settings affects new bookings only.
- **Fixed**: one doctor, one schedule, timezone Asia/Kolkata (fixed +05:30 arithmetic, times stored as UTC epoch milliseconds), bookable from 15 minutes ahead up to 14 days ahead (today plus 13).
- **Language**: English, Hinglish and Hindi are understood; replies are always English.

## Stack

Next.js 16 (App Router), Vercel AI SDK 7 with `@ai-sdk/openai` and Zod structured output, model `gpt-6-luna` with reasoning effort `none` (about 2.3 seconds per typed message when measured; taps make no model call), Drizzle ORM on SQLite through libSQL (a local file in development, Turso when hosted), nanoid, Tailwind 4, Vitest. Hosted on Vercel at `tring.zwala.dev`.

## Agent architecture

The model never controls flow and never writes text the patient sees.

1. A typed message triggers one single-shot model call that returns one action from a closed set, plus extracted fields.
2. Code merges and validates the fields, checks the action against the session mode, runs the matching tool against the database, and renders the reply from templates and cards.
3. Slot chips, the slot picker and the Confirm and Change buttons send typed client events straight to the server. They make no model call and go through the same validation.

### Session

One row per browser, keyed by a random httpOnly cookie, holding JSON:

- `draft`: `date` (context for a later bare time), `selectedStart`, `patientName`, `phone`, `reason`, `rescheduleOf`
- `offered`: up to three slot start times last shown
- `pending`: `{ kind: "book" | "cancel" | "reschedule", bookingId, startAt, endAt, previousStartAt, patientName, phone, reason, createdTurn, createdAt }` or null
- `lastBookingId`: the most recent booking made in this session, so "cancel my appointment" works without retyping the ID
- `awaitingIdFor`: set when the desk has asked for a booking ID, so a bare ID in the next message takes that action
- `strikes`: consecutive off-topic turns; `idMisses`: wrong booking IDs tried

The mode is derived: `awaiting_confirm` when `pending` is set, otherwise `open`. There is no other state. The session is saved with a version check, so a second request for the same session loses instead of overwriting newer state.

### Action schema

```ts
z.object({
  action: z.enum(["book", "select_slot", "confirm", "decline",
                  "cancel", "reschedule", "answer_faq", "none"]),
  fields: z.object({
    date: z.enum([...next14Dates, "past", "beyond_horizon"]).nullable(),
    hour: z.number().int().nullable(),
    minute: z.number().int().nullable(),
    partOfDay: z.enum(["morning", "afternoon", "evening"]).nullable(),
    patientName: z.string().nullable(),
    phone: z.string().nullable(),
    reason: z.string().nullable(),
    bookingId: z.string().nullable(),
  }),
  offeredSlot: z.number().int().nullable(),
  faqTopic: z.enum(["fees", "address", "hours", "doctor", "other"]).nullable(),
})
```

Lengths and ranges are checked in code, not in the schema, so an over-long name does not fail the whole parse.

### What the model sees

The current date and time in IST, the next 14 dates with weekday and relative labels ("2026-11-23 Mon, tomorrow"), the mode, which draft fields are filled (presence only, never the stored values), the offered slots, a one-line summary of any pending action, what the agent last asked for, and the patient's message. It does not see earlier messages, stored names or reasons, other bookings, or clinic free text.

### Behaviour by mode

| Action | `open` | `awaiting_confirm` |
|---|---|---|
| `book` (wants, gives or changes details) | merge fields, resolve any new time, then `nextStep` | with no new detail it is treated as `confirm`; otherwise drop pending, merge, then `nextStep` |
| `select_slot` | a valid index into `offered` selects it; otherwise resolve any time given, then `nextStep` | replaces the pending slot |
| `confirm` | blocked: "nothing to confirm yet" | execute pending if it was created on an earlier turn and is under 10 minutes old; a confirm that also carries a new time is treated as `book` |
| `decline` | clears the draft; during a reschedule the reply is "your appointment stays at its current time" | clears pending; typed during a reschedule it also ends the reschedule, while the Change button keeps it |
| `cancel` | resolve the ID, then a pending cancel | with no ID: `decline` over a booking summary, `confirm` over a cancel summary |
| `reschedule` | resolve the ID, reset the draft to `{ rescheduleOf }`, show the slot picker | with no ID over a booking summary it is treated as `book` |
| `answer_faq` | stored clinic fact, then repeat the outstanding question | stored clinic fact, then repeat the summary; pending kept |
| `none` | strike, say what Tring can do | strike, repeat the summary |

Patient fields are merged only for `book`. A pending action never executes on the turn that created it, and it runs with the values stored in `pending`, never with values from the model. A confirm button carries the pending booking ID and start time; a button from an older summary re-shows the current one, and a second tap after success re-shows the finished booking.

**Booking ID resolution** for cancel and reschedule: a regular expression over the raw message (eight characters from the ID alphabet with an optional hyphen, at least one digit), else `lastBookingId` if that booking is still upcoming, else ask and set `awaitingIdFor`.

### Dates and times

Date and time fields are a request that is evaluated once, on the turn it arrives; the result is either `selectedStart` or a set of offered slots. They are not stored, so an old request cannot be replayed on a later turn. Any new date or time first clears `selectedStart`, `offered` and a pending booking or reschedule.

- Date and time: snap to the slot grid. If it is free, select it. Otherwise give the reason (already passed, clinic closed that day, outside clinic hours with that day's hours, already taken, more than 14 days ahead) and offer the three nearest free slots.
- A bare hour such as "5" is read as 17:00 when only that reading falls inside opening hours. A part of day given with an hour resolves am or pm.
- A time with no date uses the day last discussed, else the first day on which that time is inside clinic hours and still ahead.
- A date with no time, or with a part of day: offer the first three free slots in that window, or say the day is closed or full and offer the nearest ones.
- `past` or `beyond_horizon`: say why, then offer the earliest slots.

### `nextStep(session)`

1. During a reschedule: check the booking is still upcoming; with no slot chosen, show the picker; a slot equal to the current time is refused; otherwise create a pending reschedule that copies name, phone and reason from the booking row. Availability ignores the booking being moved.
2. No slot chosen: re-show the offered slots that are still free, else the earliest three, with the slot picker.
3. Slot chosen: re-check it is still free. Then ask for the first missing item of name, phone and reason.
4. Everything present: create `pending` and show the summary card with Confirm and Change.

After a successful book, cancel or reschedule the draft, the offered slots and the pending action are all cleared.

### Slot picker

A strip of the next 14 days; under the chosen day, only the times that are free. Used for booking and rescheduling. Typing a date or time in natural language works alongside it.

### Tools (code functions, shown as tool calls in the steps panel)

- `find_slots(window)`: free slots from weekly hours, consult length, buffer and confirmed bookings.
- `create_booking(pending)`: one guarded `INSERT ... SELECT ... WHERE NOT EXISTS`, which succeeds only if no confirmed booking overlaps the interval including the buffer and the phone number has no other upcoming confirmed booking. The booking ID is generated when `pending` is created and is the primary key, so a retry or double tap is idempotent.
- `cancel_booking(id)`: `UPDATE ... SET status = 'cancelled' WHERE id = ? AND status = 'confirmed' AND start_at > now`.
- `reschedule_booking(id, slot)`: one guarded `UPDATE` with the same overlap check, excluding its own row. The ID is kept.
- `lookup_booking(id)`: returns one upcoming confirmed booking or nothing.
- `clinic_fact(topic)`: returns the stored fee, address, hours or doctor name.

If a guarded write affects no rows, code checks why (slot just taken, or phone already has a booking), clears `pending` and replies accordingly with the next free slots.

### Replies

Every reply is a template line plus optional structured blocks: slot chips, the slot picker, a summary card, a booked card, a cancelled card. The booked card and the `.ics` file are built from the row read back after the write. `faqTopic: "other"` and anything off topic get one fixed line saying what Tring can do.

## Guards

- Message length capped at 500 characters; a longer message is refused before the model is called. Model output is capped at 400 tokens.
- Name: letters, spaces and `. ' -`, 2 to 40 characters, and every word of it must appear in the patient's message. Phone: ten digits starting 6 to 9 after stripping `+91` and spaces, and the digits must appear in the patient's message. A phone number that already has an upcoming booking is refused when it is given. Reason: must be text the patient typed, control characters stripped, capped at 120 characters, stored as plain text, shown only on `/desk`, never placed in a prompt, and left out of the `.ics` file along with the phone number.
- Booking ID: 8 characters from nanoid with an unambiguous alphabet, always containing a digit so that an ordinary word cannot be mistaken for one, shown as `K7QM-4TXP`. Every miss returns the same "no active booking with that ID" line. After five misses in a session, lookups stop and the clinic phone number is shown.
- One upcoming confirmed booking per phone number.
- Button events are schema-validated and carry no patient fields; a tapped slot is re-validated against the grid and the database.
- Model failure (schema mismatch, 8-second timeout, provider error): one retry, then "I couldn't read that, and nothing was changed." with the session untouched; buttons keep working.
- Database failure: "Something went wrong on our side. Nothing was booked or changed."
- Three off-topic turns show the clinic phone number and reset the count. Nothing ever locks the chat.
- Clinic settings are validated on the server: enumerated consult length and buffer, each range's start before its end, no overlapping ranges, plain text only.
- Session state is persisted before the reply is returned. The session cookie is httpOnly, `SameSite=Lax` and `Secure` in production.

## Steps panel

A column beside the chat on desktop and a disclosure under it on mobile, hidden by default. Per turn it lists: input (text or tap), the model's action and fields with the phone masked and the latency, the guard result (mode, ALLOWED or BLOCKED with the reason), the tool call and result, and the state change (pending set or cleared, what is needed next). It never shows the prompt, other bookings or stack traces.

## Data model

- `clinic` (single row): names, phone, address, fee, `slotMinutes`, `bufferMinutes`, `weeklyHours` JSON keyed by weekday.
- `bookings`: `id`, `patientName`, `phone`, `reason`, `startAt`, `endAt`, `status` (`confirmed` or `cancelled`), `sessionId`, timestamps.
- `sessions`: `id`, `state` JSON, `updatedAt`.
- `turns`: `id`, `sessionId`, `input`, `reply` blocks, `steps`, `createdAt`. The chat history and the steps panel are rebuilt from this on reload.

## Visual design

Dark theme with yellow-400 (`#facc15`) as the only accent, used for the primary action, the selected slot and the active step. Inspired by the pakka project: IBM Plex Sans and Mono, 1px hairlines, no shadows, small radii, tinted status chips that always carry a word.

## Build order

Built in this order, each a working vertical slice: model probe against `gpt-6-luna`; slot logic and guarded booking writes; the turn engine; the patient chat with slot picker and steps panel; cancel and reschedule; the `.ics` download; the clinic desk with bookings table, settings and reset; the hosted Turso database. A check of 20 simultaneous bookings for one slot against Turso produced exactly one winner (`scripts/race-check.mts`).

## Out of scope

Multiple doctors, date overrides, a `/desk` passcode, a tool-failure demo switch, an eval suite, email or SMS, OTP, rate limiting, replies in Hindi, and a CLI or MCP surface.
