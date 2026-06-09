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
});
