import { z } from "zod";
import { runTurn } from "@/lib/agent/engine";
import { parseTurn } from "@/lib/agent/model";
import { ensureSessionId } from "@/lib/session-cookie";

const inputSchema = z.union([
  z.object({ type: z.literal("text"), text: z.string().min(1).max(4000) }),
  z.object({
    type: z.literal("tap"),
    tap: z.union([
      z.object({
        kind: z.literal("slot"),
        startAt: z.number().int().positive(),
      }),
      z.object({
        kind: z.literal("confirm"),
        bookingId: z.string().regex(/^[2-9A-HJ-NP-Z]{8}$/),
        startAt: z.number().int().positive(),
      }),
      z.object({ kind: z.literal("change") }),
    ]),
  }),
]);

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const input = inputSchema.safeParse(body);
  if (!input.success)
    return Response.json({ error: "invalid_input" }, { status: 400 });
  const sessionId = await ensureSessionId();
  const result = await runTurn(sessionId, input.data, parseTurn);
  return Response.json(result, { status: result.conflict ? 409 : 200 });
}
