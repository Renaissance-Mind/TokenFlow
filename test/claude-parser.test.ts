import { describe, expect, it } from "vitest";
import { parseClaudeJsonl } from "../src/sources/claude.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";

describe("Claude Code parser", () => {
  it("deduplicates requestless Responses IDs across content-block timestamps within a session", () => {
    // Official ccusage f49593c requestless_response_message_id_content_blocks fixture.
    const row = (timestamp: string, sessionId = "session-a", requestId?: string) => ({ timestamp, sessionId, requestId,
      message: { id: "resp_0123456789abcdef", model: "gpt-5.5", usage: { input_tokens: 100, output_tokens: 25 } } });
    const first = "2026-05-22T02:34:40.000Z", later = "2026-05-22T02:34:40.500Z";
    const parse = (rows: object[]) => parseClaudeJsonl(rows.map(row => JSON.stringify(row)).join("\n"), { sourcePath: "/fixture/claude.jsonl" });
    expect(parse([row(first), row(later)])).toHaveLength(1);
    expect(parse([row(first), row(later), row(first, "session-b")])).toHaveLength(2);
    expect(parse([row(first, "session-a", "request-a"), row(later, "session-a", "request-b")])).toHaveLength(2);
    const gateway = (timestamp: string) => ({ ...row(timestamp), message: { ...row(timestamp).message, id: "gateway-placeholder" } });
    expect(parse([gateway(first), gateway(later)])).toHaveLength(2);
  });
  it("keeps a native cost-only record for an unknown model", () => {
    const events = parseClaudeJsonl(JSON.stringify({ timestamp: "2026-09-15T12:00:00Z", costUSD: 0.5,
      message: { model: "private-model", usage: { input_tokens: 0, output_tokens: 0 } } }), { sourcePath: "/fixture/claude.jsonl" });
    expect(events).toHaveLength(1);
    expect(aggregateEvents(events)[0]).toMatchObject({ totalTokens: 0, pricingStatus: "priced", cost: { totalUsd: "0.500000" } });
  });
  it("retains upstream costUSD and prices only the unrecorded token subset", () => {
    // ccusage ea28984 claude_cli.rs auto_mode_breakdowns_report_the_stored_part_of_cost.
    const rows = [
      { timestamp: "2026-09-15T12:00:00Z", sessionId: "session-a", requestId: "request-a", message: { id: "message-a", model: "claude-sonnet-4-20250514", usage: { input_tokens: 1000, output_tokens: 100 } } },
      { timestamp: "2026-09-15T12:01:00Z", sessionId: "session-a", requestId: "request-b", costUSD: 0.5, message: { id: "message-b", model: "claude-sonnet-4-20250514", usage: { input_tokens: 500, output_tokens: 10 } } },
    ];
    const events = parseClaudeJsonl(rows.map(row => JSON.stringify(row)).join("\n"), { sourcePath: "/fixture/claude.jsonl" });
    expect(events[1].recordedCostUsd).toBe("0.5");
    const payload = toUsageSnapshotPayload(aggregateEvents(events));
    expect(payload.daily[0].total_cost_usd).toBe("0.504500");
    expect(payload.daily[0].slots[0]).toMatchObject({ recorded_cost_usd: "0.500000", recorded_usage: { input_tokens: 500, output_tokens: 10 } });
  });
  it.each([0, 0.5, -1, null, false, "0.5"])("validates recorded Claude cost %s without losing token usage", costUSD => {
    const events = parseClaudeJsonl(JSON.stringify({ timestamp: "2026-09-15T12:00:00Z", costUSD, message: { model: "private-model", usage: { input_tokens: 10, output_tokens: 1 } } }), { sourcePath: "/fixture/claude.jsonl" });
    expect(events[0].recordedCostUsd).toBe(typeof costUSD === "number" && costUSD >= 0 ? String(costUSD) : undefined);
    expect(events[0].totalTokens).toBe(11);
  });
  it("deduplicates repeated assistant usage rows by upstream message id", () => {
    const repeated = {
      timestamp: "2026-06-09T02:12:00.000Z",
      requestId: "req-1",
      message: {
        id: "msg-1",
        model: "claude-sonnet-4-6-20260217",
        usage: {
          input_tokens: 1_000,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 2_000,
          output_tokens: 300,
        },
      },
    };
    const jsonl = [JSON.stringify(repeated), JSON.stringify({ ...repeated, uuid: "outer-2" })].join(
      "\n",
    );

    const events = parseClaudeJsonl(jsonl, { sourcePath: "/tmp/claude.jsonl" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "claude",
      model: "claude-sonnet-4-6",
      bucketStart: "2026-06-09T02:00:00.000Z",
      inputTokens: 1_100,
      cachedInputTokens: 2_000,
      outputTokens: 300,
      reasoningOutputTokens: 0,
      totalTokens: 3_400,
    });
  });

  it("labels fast usage with a display model suffix while keeping base pricing", () => {
    const jsonl = JSON.stringify({
      timestamp: "2026-06-09T02:12:00.000Z",
      requestId: "req-fast",
      message: {
        id: "msg-fast",
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 1_000,
          cache_read_input_tokens: 2_000,
          output_tokens: 300,
          speed: "fast",
        },
      },
    });

    const events = parseClaudeJsonl(jsonl, { sourcePath: "/tmp/claude.jsonl" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "claude",
      model: "claude-opus-4-7-fast",
      pricingModel: "claude-opus-4-7",
      costMultiplier: "6",
      bucketStart: "2026-06-09T02:00:00.000Z",
      inputTokens: 1_000,
      cachedInputTokens: 2_000,
      outputTokens: 300,
      totalTokens: 3_300,
    });
  });

  it("prices already-suffixed fast model names through the base model", () => {
    const jsonl = JSON.stringify({
      timestamp: "2026-06-09T02:12:00.000Z",
      requestId: "req-fast-model",
      message: {
        id: "msg-fast-model",
        model: "claude-opus-4-8-fast",
        usage: {
          input_tokens: 1_000,
          output_tokens: 300,
        },
      },
    });

    const events = parseClaudeJsonl(jsonl, { sourcePath: "/tmp/claude.jsonl" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      model: "claude-opus-4-8-fast",
      pricingModel: "claude-opus-4-8",
      costMultiplier: "2",
    });
  });

  it("keeps fast pricing for known Claude models with display aliases", () => {
    withCcusageModelAliases("claude-opus-4-8=mythos-5", () => {
      const jsonl = JSON.stringify({
        timestamp: "2026-06-09T02:12:00.000Z",
        requestId: "req-fast-alias",
        message: {
          id: "msg-fast-alias",
          model: "claude-opus-4-8",
          usage: {
            input_tokens: 1_000,
            output_tokens: 300,
            speed: "fast",
          },
        },
      });

      const events = parseClaudeJsonl(jsonl, { sourcePath: "/tmp/claude.jsonl" });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        model: "mythos-5-fast",
        pricingModel: "claude-opus-4-8",
        costMultiplier: "2",
      });
    });
  });
});

function withCcusageModelAliases<T>(value: string, callback: () => T): T {
  const previous = process.env.CCUSAGE_MODEL_ALIASES;
  process.env.CCUSAGE_MODEL_ALIASES = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.CCUSAGE_MODEL_ALIASES;
    else process.env.CCUSAGE_MODEL_ALIASES = previous;
  }
}
