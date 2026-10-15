import { describe, it, expect } from "vitest";
import { dashboardCache, localDashboardApi } from "../src/local-dashboard.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { parseCodexJsonl } from "../src/sources/codex.js";

describe("the local data adapter for the canonical Dashboard", () => {
  const events = parseCodexJsonl([
    { type: "session_meta", payload: { session_id: "private-session" } },
    { type: "turn_context", payload: { model: "gpt-5.2-codex" } },
    { type: "event_msg", timestamp: "2026-06-09T01:05:00.000Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 100, reasoning_output_tokens: 25 } } } },
  ].map(value => JSON.stringify(value)).join("\n"), { sourcePath: "/private/rollout.jsonl" });
  const cache = dashboardCache(aggregateEvents(events));
  const config = { deviceId: "device-1", deviceName: "Work computer" };
  it("reports the same token dimensions to summary, trend, and hourly charts", () => {
    const summary: any = localDashboardApi(cache, config, "/api/usage/summary?from=2026-06-09&to=2026-06-09");
    expect(summary.totals).toMatchObject({ total_tokens: "1100", input_tokens: "1000", cached_input_tokens: "400", output_tokens: "100", reasoning_output_tokens: "25" });
    expect(summary.devices).toHaveLength(1); expect(summary.devices[0].device_id).toBe("device-1");
    const heatmap: any = localDashboardApi(cache, config, "/api/usage/heatmap?from=2026-06-08&to=2026-06-10");
    expect(heatmap.days.map((d: any) => [d.date, d.total_tokens, d.level])).toEqual([["2026-06-08", "0", 0], ["2026-06-09", "1100", 4], ["2026-06-10", "0", 0]]);
    const hourly: any = localDashboardApi(cache, config, "/api/usage/hourly?from=2026-06-09&to=2026-06-09");
    expect(hourly.hours[0]).toMatchObject({ hour: "2026-06-09T01", total_tokens: "1100" });
  });
  it("filters by dates, device, agent and model, without exposing source records", () => {
    for (const filter of ["device_id=other", "agent=claude", "model=other"]) {
      const result: any = localDashboardApi(cache, config, "/api/usage/summary?from=2026-06-09&to=2026-06-09&" + filter);
      expect(result.totals.total_tokens).toBe("0");
    }
    expect(JSON.stringify(cache)).not.toContain("private");
    expect(() => localDashboardApi(cache, config, "/api/usage/summary?from=2026-06-10&to=2026-06-09")).toThrow("Invalid Dashboard date range");
  });
});
