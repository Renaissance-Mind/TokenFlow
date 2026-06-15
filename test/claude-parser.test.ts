import { describe, expect, it } from "vitest";
import { parseClaudeJsonl } from "../src/sources/claude.js";

describe("Claude Code parser", () => {
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
