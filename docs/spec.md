# Tring — design spec

Tring is a chat agent that books, cancels and reschedules appointments for one single-doctor clinic. It is a hackathon build (solo, about five hours in total) for the brief "build an agent that takes a real task from start to finish using at least one tool, then defend it against bad input". Judging: usefulness 30, agent design 25, unbreakable 25, demo and clarity 20. Strangers will open it on their phones and try to break it.

## Product

- **Patient side (`/`)**: a web chat with no login. The patient gives a name, a phone number and a reason for visit, picks a free slot, confirms, and receives a booking ID and an "Add to calendar" `.ics` download. The booking ID alone later unlocks cancel and reschedule.
- **Clinic side (`/desk`)**: no login and no passcode (owner's decision). It has a read-only table of all bookings (time, patient, phone, reason, status), a settings form, a "reset demo data" button and a QR code for the patient link.
- **Settings**: weekly hours as a toggle plus one or more time ranges per weekday (a second range gives a lunch break), consult length (15/20/30 minutes), buffer between appointments (0/5/10/15 minutes), doctor name, clinic name, phone, address and fee. Changing settings affects new bookings only.
- **Fixed**: one doctor, one schedule, timezone Asia/Kolkata (fixed +05:30 arithmetic, times stored as UTC epoch milliseconds), bookable up to 14 days ahead.
- **Language**: English, Hinglish and Hindi are understood; replies are always English.

## Stack

Next.js 16 (App Router), Vercel AI SDK 7 with `@ai-sdk/openai` and Zod structured output, model `gpt-6-luna`, Drizzle ORM on SQLite through libSQL (a local file in development, Turso when hosted), nanoid, Tailwind 4, Vitest. Hosted on Vercel at `tring.zwala.dev`.

## Agent architecture

The model never controls flow and never writes text the patient sees.

1. A typed message triggers one single-shot model call that returns one action from a closed set, plus extracted fields.
2. Code merges and validates the fields, checks the action against the session mode, runs the matching tool against the database, and renders the reply from templates and cards.
3. Slot chips, the slot picker and the Confirm and Change buttons send typed client events straight to the server. They make no model call and go through the same validation.

### Session

One row per browser, keyed by a random httpOnly cookie, holding JSON:

- `draft`: `date`, `time`, `partOfDay`, `selectedStart`, `patientName`, `phone`, `reason`, `rescheduleOf`
- `offered`: up to three slot start times last shown
- `pending`: `{ kind: "book" | "cancel" | "reschedule", bookingId, startAt, endAt, patientName, phone, reason, createdTurn }` or null
- `lastBookingId`: the most recent booking made in this session, so "cancel my appointment" works without retyping the ID
- `strikes`: consecutive confused turns; `idMisses`: wrong booking IDs tried

The mode is derived: `awaiting_confirm` when `pending` is set, otherwise `open`. There is no other state.

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
| `book` (wants, gives or changes details) | merge fields, then `nextStep` | drop pending, merge, then `nextStep` |
| `select_slot` | a valid index into `offered` selects it; otherwise re-offer | replaces the pending slot |
| `confirm` | blocked: "nothing to confirm yet", then `nextStep` | execute pending if it was created on an earlier turn and is under 10 minutes old |
| `decline` | no-op, then `nextStep` | clear pending, ask what to change |
| `cancel` | valid ID gives a pending cancel; otherwise ask for the ID | replaces pending |
| `reschedule` | valid ID sets `rescheduleOf`, shows the slot picker | replaces pending |
| `answer_faq` | stored clinic fact, then repeat the outstanding question | stored clinic fact, then repeat the summary; pending kept |
| `none` | strike, nudge | strike, repeat the summary |

Fields are extracted and merged on every action. A pending action never executes on the turn that created it, and it runs with the values stored in `pending`, never with values from the model.

### `nextStep(session)`

1. No date or time given: offer the earliest three free slots and the slot picker.
2. Date without a time, or a part of day: offer the first three free slots in that window. If the clinic is closed that day, say so and offer the next open day.
3. Date and time: snap to the slot grid. If it is free, select it. Otherwise give the reason (in the past, clinic closed then, already taken, more than 14 days ahead) and offer the three nearest free slots. A bare hour such as "5" is read as 17:00 when only that reading falls inside opening hours.
4. Slot selected but name, phone or reason missing: ask for the first missing one.
5. Everything present: create `pending` and show the summary card with Confirm and Change.

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

- Message length capped at 500 characters.
- Name: letters, spaces and `. ' -`, 2 to 40 characters. Phone: ten digits starting 6 to 9 after stripping `+91` and spaces. Reason: control characters stripped, capped at 120 characters, stored as plain text, shown only on `/desk`, never placed in a prompt, and escaped in the `.ics` file.
- Booking ID: 8 characters from nanoid with an unambiguous alphabet, shown as `K7QM-4TXP`. Every miss returns the same "no active booking with that ID" line. After five misses in a session, lookups stop and the clinic phone number is shown.
- One upcoming confirmed booking per phone number.
- Model failure (schema mismatch, 8-second timeout, provider error): one retry, then "I couldn't read that. Nothing was changed." with the session untouched; buttons keep working.
- Database failure: "Something went wrong on our side. Nothing was booked or changed."
- Three strikes show the clinic phone number and reset the count. Nothing ever locks the chat.
- Session state is persisted before the reply is returned.

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

Each step is a working vertical slice; if time runs out, the missing pieces are the last ones.

1. Deployed skeleton on Vercel with Turso, opened on a phone, with one real `gpt-6-luna` call using the action schema.
2. Book end to end from seeded hours, with the steps panel.
3. Cancel by booking ID.
4. Bookings table on `/desk`.
5. `.ics` download.
6. Settings editor with weekly hours, consult length and buffer.
7. Reschedule with the slot picker.

## Out of scope

Multiple doctors, date overrides, a `/desk` passcode, a tool-failure demo switch, an eval suite, email or SMS, OTP, rate limiting, replies in Hindi, and a CLI or MCP surface.
