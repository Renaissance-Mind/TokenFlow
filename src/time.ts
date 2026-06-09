export function toUtcHalfHourStart(timestamp: string): string | null {
  const date = new Date(timestamp);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  const halfHourMs = 30 * 60 * 1000;
  return new Date(Math.floor(time / halfHourMs) * halfHourMs).toISOString();
}
