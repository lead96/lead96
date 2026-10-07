/** Display helpers. Times are shown in the business's own time zone. */

export function formatDateTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
export function timeAgo(iso: string, timeZone: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}

/** +13055550101 → (305) 555-0101 */
export function formatPhone(e164: string | null | undefined) {
  const m = e164?.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 ?? "");
}
