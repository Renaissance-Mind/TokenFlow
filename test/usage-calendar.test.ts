import { describe, expect, it } from "vitest";
import { calendarDate, usageRange } from "../src/usage-calendar.js";
describe("reporting calendar", () => {
  const range = (day: string, zone: string) => usageRange(new URLSearchParams({ from: day, to: day, time_zone: zone }));
  it("includes the previous UTC evening in a Shanghai day", () => {
    expect(range("2026-11-08", "Asia/Shanghai")).toMatchObject({ fromIso: "2026-11-07T16:00:00.000Z", toIso: "2026-11-08T15:59:59.999Z", calendarDays: 1 });
    expect(calendarDate("2026-11-07T16:00:00Z", "Asia/Shanghai")).toBe("2026-11-08");
  });
  it("uses each date's DST offset, including short and long days", () => {
    const spring = range("2026-03-08", "America/New_York"), fall = range("2026-11-01", "America/New_York");
    expect(spring.fromIso).toBe("2026-03-08T05:00:00.000Z");
    expect(spring.end - spring.start + 1).toBe(23 * 3_600_000);
    expect(fall.fromIso).toBe("2026-11-01T04:00:00.000Z");
    expect(fall.end - fall.start + 1).toBe(25 * 3_600_000);
  });
  it("supports fractional offsets and finds today in the requested zone", () => {
    expect(range("2026-11-08", "Asia/Kathmandu").fromIso).toBe("2026-11-07T18:15:00.000Z");
    expect(usageRange(new URLSearchParams({days:"1",time_zone:"Asia/Shanghai"}), new Date("2026-11-07T17:00:00Z")).toDate).toBe("2026-11-08");
    expect(usageRange(new URLSearchParams({days:"1"}), new Date("2026-11-07T17:00:00Z")).toDate).toBe("2026-11-07");
  });
  it("rejects invalid zones, impossible dates and reversed ranges", () => {
    expect(() => range("2026-02-30","UTC")).toThrow(RangeError);
    expect(() => range("2026-11-08","Invalid/Zone")).toThrow(RangeError);
    expect(() => usageRange(new URLSearchParams({from:"2026-11-09",to:"2026-11-08"}))).toThrow(RangeError);
  });
});
