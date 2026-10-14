/**
 * Phone numbers arrive in every shape: "098765 43210", "+91-98765-43210",
 * "9876543210". The key is digits only with the country code, so duplicates
 * are caught however they were typed. Ten-digit numbers are taken as Indian.
 */
export function phoneKey(raw: string | null | undefined, defaultCountry = "91"): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  digits = digits.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = defaultCountry + digits;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

/** "+91 98765 43210" for display and for dialling. */
export function formatPhone(key: string | null | undefined): string | null {
  if (!key) return null;
  if (key.startsWith("91") && key.length === 12) return `+91 ${key.slice(2, 7)} ${key.slice(7)}`;
  return `+${key}`;
}

/** E.164, for telephony providers. */
export const e164 = (key: string) => `+${key}`;

export function emailKey(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null;
}

export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(pvt|private|ltd|limited|llp|inc|co|corp|corporation|company)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}
