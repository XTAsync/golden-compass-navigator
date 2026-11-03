/** Normalise a Kenyan M-Pesa number to 2547XXXXXXXX / 2541XXXXXXXX, or null when invalid. */
export function normaliseKenyanPhone(raw: unknown): string | null {
  let phone = String(raw ?? "").replace(/\D/g, "");
  if (phone.startsWith("0")) phone = "254" + phone.slice(1);
  else if (phone.startsWith("7") || phone.startsWith("1")) phone = "254" + phone;
  return /^254(7|1)\d{8}$/.test(phone) ? phone : null;
}
