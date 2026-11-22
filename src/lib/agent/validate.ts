export const MAX_MESSAGE = 500;
export const MAX_REASON = 120;

const NAME = /^[\p{L}\p{M}][\p{L}\p{M} .'-]{1,39}$/u;

export function cleanName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return NAME.test(name) ? name : null;
}

export function cleanPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function cleanReason(raw: string): string | null {
  const reason = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_REASON);
  return reason.length >= 2 ? reason : null;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 2)}••••••${phone.slice(-2)}`;
}
