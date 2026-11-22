import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { emptyState, type SessionState, type TurnRecord } from "./types";

export type LoadedSession = { state: SessionState; version: number | null };

export async function loadSession(id: string): Promise<LoadedSession> {
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id));
  if (!row) return { state: emptyState(), version: null };
  return {
    state: { ...emptyState(), ...(row.state as SessionState) },
    version: row.updatedAt,
  };
}

// The version check makes a second request for the same session lose instead of overwriting newer state.
export async function saveSession(
  id: string,
  state: SessionState,
  version: number | null,
  nowMs: number,
) {
  if (version === null) {
    const result = await db
      .insert(schema.sessions)
      .values({ id, state, updatedAt: nowMs })
      .onConflictDoNothing();
    return result.rowsAffected > 0;
  }
  const next = Math.max(nowMs, version + 1);
  const result = await db
    .update(schema.sessions)
    .set({ state, updatedAt: next })
    .where(
      and(eq(schema.sessions.id, id), eq(schema.sessions.updatedAt, version)),
    );
  return result.rowsAffected > 0;
}

export async function recordTurn(
  sessionId: string,
  turn: Omit<TurnRecord, "id">,
): Promise<TurnRecord> {
  const [row] = await db
    .insert(schema.turns)
    .values({
      sessionId,
      input: turn.input,
      reply: turn.reply,
      steps: turn.steps,
      createdAt: turn.createdAt,
    })
    .returning({ id: schema.turns.id });
  return { ...turn, id: row.id };
}

export async function listTurns(sessionId: string): Promise<TurnRecord[]> {
  const rows = await db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.sessionId, sessionId))
    .orderBy(asc(schema.turns.id));
  return rows.map((r) => ({
    id: r.id,
    input: r.input as TurnRecord["input"],
    reply: r.reply as TurnRecord["reply"],
    steps: r.steps as TurnRecord["steps"],
    createdAt: r.createdAt,
  }));
}
