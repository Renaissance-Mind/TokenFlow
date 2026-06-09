import { describe, expect, it } from "vitest";
import { parseGeminiSession } from "../src/sources/gemini.js";

describe("Gemini parser", () => {
  it("diffs cumulative message token totals into bucketed usage events", () => {
    const session = JSON.stringify({
      messages: [
        {
          timestamp: "2026-06-09T03:01:00.000Z",
          model: "google/gemini-3-pro-preview-20260514",
          tokens: { input: 100, cached: 20, output: 10, thoughts: 5, tool: 2, total: 137 },
        },
        {
          timestamp: "2026-06-09T03:34:00.000Z",
          model: "google/gemini-3-pro-preview-20260514",
          tokens: { input: 160, cached: 25, output: 30, thoughts: 7, tool: 3, total: 225 },
        },
      ],
    });

    const events = parseGeminiSession(session, { sourcePath: "/tmp/session.json" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      agent: "gemini",
      model: "gemini-3-pro-preview",
      bucketStart: "2026-06-09T03:00:00.000Z",
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 12,
      reasoningOutputTokens: 5,
      totalTokens: 137,
    });
    expect(events[1]).toMatchObject({
      bucketStart: "2026-06-09T03:30:00.000Z",
      inputTokens: 60,
      cachedInputTokens: 5,
      outputTokens: 21,
      reasoningOutputTokens: 2,
      totalTokens: 88,
    });
  });
});
