import { describe, expect, it } from "vitest";
import { parseQwenChatJsonl } from "../src/sources/qwen.js";

describe("Qwen parser", () => {
  it("reads assistant usageMetadata rows from Qwen chat JSONL", () => {
    const jsonl = [
      JSON.stringify({
        type: "user",
        timestamp: "2026-06-09T01:00:00.000Z",
      }),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-09T01:05:00.000Z",
        sessionId: "session-a",
        model: "qwen3-coder-plus",
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          thoughtsTokenCount: 7,
          cachedContentTokenCount: 10,
          totalTokenCount: 170,
        },
      }),
    ].join("\n");

    const events = parseQwenChatJsonl(jsonl, {
      sourcePath: "/tmp/.qwen/projects/repo/chats/chat.jsonl",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "qwen",
      model: "qwen3-coder-plus",
      pricingModel: "qwen3-coder-plus",
      sessionId: "session-a",
      bucketStart: "2026-06-09T01:00:00.000Z",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 50,
      reasoningOutputTokens: 7,
      extraTotalTokens: 3,
      totalTokens: 170,
    });
  });

  it("falls back totalTokenCount to output when split fields are missing", () => {
    const events = parseQwenChatJsonl(
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-09T01:05:00.000Z",
        model: "qwen3-coder-plus",
        usageMetadata: { totalTokenCount: 321 },
      }),
      { sourcePath: "/tmp/.qwen/projects/repo/chats/chat.jsonl" },
    );

    expect(events[0]).toMatchObject({
      outputTokens: 321,
      extraTotalTokens: 0,
      totalTokens: 321,
    });
  });
});
