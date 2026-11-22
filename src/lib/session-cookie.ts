import { nanoid } from "nanoid";
import { cookies } from "next/headers";

const NAME = "tring_sid";

export async function readSessionId(): Promise<string | null> {
  const value = (await cookies()).get(NAME)?.value;
  return value && /^[\w-]{16,40}$/.test(value) ? value : null;
}

export async function ensureSessionId(): Promise<string> {
  const existing = await readSessionId();
  if (existing) return existing;
  const id = nanoid(24);
  (await cookies()).set({
    name: NAME,
    value: id,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
}
