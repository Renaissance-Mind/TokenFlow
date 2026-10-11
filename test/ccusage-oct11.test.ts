import { describe, expect, it } from "vitest";
import { parseCodexJsonl } from "../src/sources/codex.js";
import { parseClaudeJsonl } from "../src/sources/claude.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";
import { bucketSyncKey } from "../src/sync-state.js";
import { codexServiceTierFromConfig } from "../src/file-scan.js";

describe("ccusage recorded service tiers and response identities", () => {
  it("uses only an active TOML profile for config fallback", () => {
    expect(codexServiceTierFromConfig('service_tier = "standard"\n[profiles.flex]\nservice_tier = "flex"')).toBe("standard");
    expect(codexServiceTierFromConfig('profile = "flex.#"\nservice_tier = "fast"\n[profiles."flex.#"]\nservice_tier = "flex"')).toBe("flex");
    expect(codexServiceTierFromConfig('service_tier = "flex')).toBeNull();
  });
  it("applies the server catalog's new Fast multiplier when local tables omit it", () => {
    const event = parseCodexJsonl(JSON.stringify({ type: "event_msg", timestamp: "2026-07-22T00:00:05Z", payload: { type: "token_count", info: { model: "gpt-6.1-sol", last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } }), { sourcePath: "/fixture/codex.jsonl", serviceTier: "fast" })[0];
    const profiles = [{ modelId: "gpt-6.1-sol", displayName: "GPT", inputUsdPerMillion: "2", outputUsdPerMillion: "10", cacheReadUsdPerMillion: "0.1", cacheCreationUsdPerMillion: "2.5", fastMultiplier: "2" }];
    expect(aggregateEvents([{ ...event, costMultiplier: undefined }], profiles)[0].cost.totalUsd).toBe("0.000600");
  });
  it("keeps recorded Flex usage separate from standard usage through daily-v1", () => {
    const settings = (tier: string) => ({ type: "event_msg", payload: { type: "thread_settings_applied", thread_settings: { service_tier: tier } } });
    const usage = (second: string) => ({ type: "event_msg", timestamp: `2026-07-22T00:00:${second}Z`, payload: { type: "token_count", info: { model: "gpt-6-astra", last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } });
    const events = parseCodexJsonl([settings("flex"), usage("05"), settings("standard"), usage("06")].map(JSON.stringify).join("\n"), { sourcePath: "/fixture/codex.jsonl" });
    expect(events.map(e => e.serviceTier)).toEqual(["flex", "standard"]);
    const profiles = [{ modelId: "gpt-6-astra", displayName: "GPT", inputUsdPerMillion: "10", outputUsdPerMillion: "20", cacheReadUsdPerMillion: "1", cacheCreationUsdPerMillion: "10", flexMultiplier: "0.5" }];
    const buckets = aggregateEvents(events, profiles);
    expect(buckets).toHaveLength(2);
    expect(new Set(buckets.map(bucketSyncKey)).size).toBe(2);
    expect(buckets.find(b => b.serviceTier === "flex")?.cost.totalUsd).toBe("0.000600");
    const slots = toUsageSnapshotPayload(buckets).daily.flatMap(day => day.slots);
    expect(slots.filter(s => s.service_tier === "flex")).toHaveLength(1);
    expect(slots.filter(s => s.service_tier === "standard")).toHaveLength(1);
    expect(slots.reduce((sum, s) => sum + s.total_tokens, 0)).toBe(220);
  });

  it("deduplicates real Anthropic blocks but retains requestless gateway placeholder calls", () => {
    const row = (id: string, timestamp: string, sessionId = "session-a") => ({ sessionId, timestamp, message: { id, model: "claude-sonnet-4-20250514", usage: { input_tokens: 100, output_tokens: 25 } } });
    const rows = [row("msg_01AbC2DeF3", "2026-05-22T02:34:40Z"), row("msg_01AbC2DeF3", "2026-05-22T02:34:40.500Z"), row("gateway", "2026-05-22T02:34:41Z"), row("gateway", "2026-05-22T02:34:42Z"), row("msg_01AbC2DeF3", "2026-05-22T02:34:40Z", "session-b")];
    expect(parseClaudeJsonl(rows.map(JSON.stringify).join("\n"), { sourcePath: "/fixture/claude.jsonl" })).toHaveLength(4);
  });
});
