import { describe, expect, it } from "vitest";
import { parseKimiWireJsonl } from "../src/sources/kimi.js";

describe("Kimi parser", () => {
  it("reads StatusUpdate token_usage records from wire JSONL", () => {
    const jsonl = [
      JSON.stringify({
        timestamp: 1770983426.420942,
        message: { type: "TurnBegin", payload: { user_input: "hello" } },
      }),
      JSON.stringify({
        timestamp: 1770983427.123,
        message: {
          type: "StatusUpdate",
          payload: {
            message_id: "msg-1",
            token_usage: {
              input_other: 100,
              output: 50,
              input_cache_read: 10,
              input_cache_creation: 20,
            },
          },
        },
      }),
    ].join("\n");

    const events = parseKimiWireJsonl(jsonl, {
      sourcePath: "/tmp/.kimi/sessions/group/session-a/wire.jsonl",
      model: "kimi-k2",
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "kimi",
      model: "kimi-k2",
      sessionId: "session-a",
      timestamp: "2026-02-13T11:50:27.123Z",
      bucketStart: "2026-02-13T11:30:00.000Z",
      inputTokens: 100,
      cachedInputTokens: 10,
      outputTokens: 50,
      cacheCreationTokens: 20,
      totalTokens: 180,
    });
  });

  it("keeps kimi-for-coding as display model and prices by timestamp mapping", () => {
    const before = parseKimiWireJsonl(
      JSON.stringify({
        timestamp: 1776698890.071,
        message: { type: "StatusUpdate", payload: { token_usage: { input_other: 100 } } },
      }),
      {
        sourcePath: "/tmp/.kimi/sessions/group/before/wire.jsonl",
        model: "kimi-for-coding",
      },
    )[0];
    const after = parseKimiWireJsonl(
      JSON.stringify({
        timestamp: 1776698890.072,
        message: { type: "StatusUpdate", payload: { token_usage: { input_other: 100 } } },
      }),
      {
        sourcePath: "/tmp/.kimi/sessions/group/after/wire.jsonl",
        model: "kimi-for-coding",
      },
    )[0];

    expect(before.model).toBe("kimi-for-coding");
    expect(before.pricingModel).toBe("moonshot/kimi-k2.5");
    expect(after.model).toBe("kimi-for-coding");
    expect(after.pricingModel).toBe("moonshot/kimi-k2.6");
  });
});
