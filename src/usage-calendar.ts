// Shared reporting contract: calendar dates are interpreted in an explicit IANA
// timezone. Omitted time_zone retains the public API's historical UTC behavior.
const DAY = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let value = formatters.get(timeZone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    if (formatters.size >= 32) formatters.clear();
    formatters.set(timeZone, value);
  }
  return value;
}
export function calendarDate(value: Date | string | number, timeZone = "UTC"): string {
  const parts = formatter(timeZone).formatToParts(new Date(value));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dateNumber(value: string): number {
  const at = Date.parse(value + "T00:00:00.000Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(at) || new Date(at).toISOString().slice(0, 10) !== value)
    throw new RangeError("Invalid Dashboard date range");
  return at;
}
export function addCalendarDays(value: string, days: number): string {
  return new Date(dateNumber(value) + days * DAY).toISOString().slice(0, 10);
}
// Find the first instant belonging to this calendar date. This handles 23/25h
// days and zones whose DST transition occurs at midnight, without a fixed offset.
export function calendarStart(date: string, timeZone: string): number {
  const at = dateNumber(date);
  if (timeZone === "UTC") return at;
  let low = at - 36 * 3_600_000, high = at + 36 * 3_600_000;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (calendarDate(mid, timeZone) < date) low = mid + 1;
    else high = mid;
  }
  return low;
}
export function usageRange(params: URLSearchParams, now = new Date(), defaultDays = 30, maxDays = 370) {
  const timeZone = params.get("time_zone") || "UTC";
  formatter(timeZone); // Reject unknown zones even for an explicitly empty range.
  const toDate = params.get("to") || calendarDate(now, timeZone);
  const requestedDays = Number(params.get("days") || defaultDays);
  const days = Number.isInteger(requestedDays) && requestedDays > 0 ? Math.min(maxDays, requestedDays) : defaultDays;
  const fromDate = params.get("from") || addCalendarDays(toDate, 1 - days);
  const calendarDays = (dateNumber(toDate) - dateNumber(fromDate)) / DAY + 1;
  if (calendarDays < 1) throw new RangeError("Invalid Dashboard date range");
  const start = calendarStart(fromDate, timeZone), end = calendarStart(addCalendarDays(toDate, 1), timeZone) - 1;
  return { fromDate, toDate, timeZone, calendarDays, start, end, fromIso: new Date(start).toISOString(), toIso: new Date(end).toISOString() };
}
