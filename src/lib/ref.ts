// No 0/O or 1/I, so a ref read aloud or retyped by hand stays unambiguous. Must match public/t.js.
export const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const REF_LENGTH = 5;

const REF_RE = new RegExp(`^[${REF_ALPHABET}]{${REF_LENGTH}}$`);
// "+" tolerated as a space in case a link was form-encoded somewhere along the way.
const IN_TEXT_RE = /\bref\.?[\s+]*[:#-]?[\s+]*([a-z0-9]{5})\b/i;

export function isValidRef(ref: unknown): ref is string {
  return typeof ref === 'string' && REF_RE.test(ref);
}

export function extractRef(text: string): string | null {
  const m = IN_TEXT_RE.exec(text);
  if (!m) return null;
  const ref = m[1]!.toUpperCase();
  return isValidRef(ref) ? ref : null;
}
