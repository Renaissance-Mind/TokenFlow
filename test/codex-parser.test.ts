import { describe, expect, it } from "vitest";
import { parseCodexJsonl } from "../src/sources/codex.js";

describe("Codex JSONL parser", () => {
  it("turns cumulative token_count entries into deduplicated deltas", () => {
    const lines = [
      JSON.stringify({ type: "session_meta", payload: { session_id: "s1", cwd: "/repo" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "OpenAI/GPT-5.2-Codex@HIGH" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-09T01:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 400,
              output_tokens: 100,
              reasoning_output_tokens: 25,
            },
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-09T01:06:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 400,
              output_tokens: 100,
              reasoning_output_tokens: 25,
            },
          },
        },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-09T01:40:00.000Z",
        payload: {
          type: "token_count",
          info: {
            model: "gpt-5.2-codex-medium",
            total_token_usage: {
              input_tokens: 1_500,
              cache_read_input_tokens: 550,
              output_tokens: 175,
              reasoning_output_tokens: 40,
            },
          },
        },
      }),
    ].join("\n");

    const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      agent: "codex",
      sessionId: "s1",
      bucketStart: "2026-06-09T01:00:00.000Z",
      model: "gpt-5.2-codex-high",
      inputTokens: 1_000,
      cachedInputTokens: 400,
      outputTokens: 100,
      reasoningOutputTokens: 25,
      totalTokens: 1_525,
    });
    expect(events[1]).toMatchObject({
      bucketStart: "2026-06-09T01:30:00.000Z",
      model: "gpt-5.2-codex-medium",
      inputTokens: 500,
      cachedInputTokens: 150,
      outputTokens: 75,
      reasoningOutputTokens: 15,
      totalTokens: 740,
    });
  });

  it("backfills early token counts when a session has one later model context", () => {
    const lines = [
      JSON.stringify({
        type: "session_meta",
        payload: { session_id: "s1", model_provider: "openai", model_context_window: 272_000 },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-13T03:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000,
              cached_input_tokens: 100,
              output_tokens: 50,
            },
          },
        },
      }),
      JSON.stringify({
        type: "turn_context",
        payload: {
          model: "OpenAI/GPT-5.5",
          collaboration_mode: { settings: { model: "OpenAI/GPT-5.5" } },
        },
      }),
    ].join("\n");

    const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      model: "gpt-5.5",
      totalTokens: 1_150,
    });
  });

  it("keeps early unknown token counts when a session contains multiple real models", () => {
    const lines = [
      JSON.stringify({ type: "session_meta", payload: { session_id: "s1", model_provider: "openai" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-05-13T03:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000,
              output_tokens: 50,
            },
          },
        },
      }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.4" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.5" } }),
    ].join("\n");

    const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      model: "unknown",
      totalTokens: 1_050,
    });
  });
});
