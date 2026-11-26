import { describe, expect, it } from "vitest";
import { parseQwenChatJsonl } from "../src/sources/qwen.js";
import { calculateCost, resolvePricing } from "../src/pricing.js";

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
      inputTokens: 90,
      cachedInputTokens: 10,
      outputTokens: 50,
      reasoningOutputTokens: 7,
      extraTotalTokens: 13,
      totalTokens: 170,
    });
  });

  it("keeps tokens without a breakdown in the total without billing them as output", () => {
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
      outputTokens: 0,
      extraTotalTokens: 321,
      totalTokens: 321,
    });
    expect(calculateCost("qwen", events[0], resolvePricing("qwen3-coder-plus")!).totalUsd).toBe("0.000000");
  });

  it("does not count cached prompt tokens or thoughts already included in candidates twice", () => {
    const [event] = parseQwenChatJsonl(JSON.stringify({
      type: "assistant",
      timestamp: "2026-02-23T14:24:56.857Z",
      sessionId: "s",
      model: "qwen3-coder-plus",
      usageMetadata: {
        promptTokenCount: 1000,
        candidatesTokenCount: 200,
        thoughtsTokenCount: 50,
        cachedContentTokenCount: 400,
        totalTokenCount: 1200,
      },
    }), { sourcePath: "/tmp/.qwen/projects/repo/chats/chat.jsonl" });
    expect(event).toMatchObject({
      inputTokens: 600,
      cachedInputTokens: 400,
      outputTokens: 200,
      reasoningOutputTokens: 0,
      extraTotalTokens: 0,
      totalTokens: 1200,
    });
  });
});
