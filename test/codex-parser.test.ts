import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../src/usage-buckets.js";
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

  it("resolves ccusage model aliases before emitting Codex usage events", () => {
    withCcusageModelAliases("private-codex-alpha=gpt-5.5", () => {
      const lines = [
        JSON.stringify({ type: "session_meta", payload: { session_id: "s1" } }),
        JSON.stringify({ type: "turn_context", payload: { model: "private-codex-alpha" } }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-09T01:05:00.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                output_tokens: 50,
              },
            },
          },
        }),
      ].join("\n");

      const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl" });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        model: "gpt-5.5",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      });
    });
  });

  it("keeps original pricing for known Codex models with display aliases", () => {
    withCcusageModelAliases("gpt-5.5=mythos-5", () => {
      const lines = [
        JSON.stringify({ type: "session_meta", payload: { session_id: "s1" } }),
        JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.5" } }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-09T01:05:00.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                output_tokens: 50,
              },
            },
          },
        }),
      ].join("\n");

      const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl" });
      const buckets = aggregateEvents(events);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        model: "mythos-5",
        pricingModel: "gpt-5.5",
      });
      expect(buckets[0]).toMatchObject({
        model: "mythos-5",
        pricingModel: "gpt-5.5",
        pricingStatus: "priced",
      });
    });
  });

  it("applies ccusage Codex fast pricing multipliers without changing the displayed model", () => {
    const lines = [
      JSON.stringify({ type: "session_meta", payload: { session_id: "s1" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "OpenAI/GPT-5.5" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-09T01:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000_000,
              cached_input_tokens: 0,
              output_tokens: 0,
            },
          },
        },
      }),
    ].join("\n");

    const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl", serviceTier: "fast" });
    const buckets = aggregateEvents(events);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      model: "gpt-5.5",
      costMultiplier: "2.5",
    });
    expect(buckets[0]).toMatchObject({
      model: "gpt-5.5",
      costMultiplier: "2.5",
      cost: {
        inputUsd: "25.000000",
        totalUsd: "25.000000",
      },
    });
  });

  it("uses ccusage's default Codex fast multiplier for models without explicit overrides", () => {
    const lines = [
      JSON.stringify({ type: "session_meta", payload: { session_id: "s1" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "OpenAI/GPT-5.2-Codex" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-09T01:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000_000,
              cached_input_tokens: 0,
              output_tokens: 0,
            },
          },
        },
      }),
    ].join("\n");

    const events = parseCodexJsonl(lines, { sourcePath: "/tmp/rollout.jsonl", serviceTier: "priority" });

    expect(events[0]).toMatchObject({
      model: "gpt-5.2-codex",
      costMultiplier: "2",
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

  it("ignores inherited parent usage replayed into a subagent rollout", () => {
    const lines = [
      JSON.stringify({
        timestamp: "2026-07-12T09:31:08.383Z",
        type: "session_meta",
        payload: {
          id: "subagent-session",
          session_id: "parent-session",
          source: {
            subagent: {
              thread_spawn: {
                parent_thread_id: "parent-session",
                depth: 1,
                agent_path: "/root/audit",
              },
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-12T09:31:08.384Z",
        type: "session_meta",
        payload: { id: "parent-session", session_id: "parent-session", source: "vscode" },
      }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5.6-sol" } }),
      JSON.stringify({
        timestamp: "2026-07-12T09:31:08.385Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_000_000,
              cached_input_tokens: 900_000,
              output_tokens: 10_000,
              reasoning_output_tokens: 1_000,
              total_tokens: 1_010_000,
            },
            last_token_usage: {
              input_tokens: 100_000,
              cached_input_tokens: 90_000,
              output_tokens: 1_000,
              reasoning_output_tokens: 100,
              total_tokens: 101_000,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-07-12T09:31:12.075Z",
        type: "inter_agent_communication_metadata",
        payload: { trigger_turn: true },
      }),
      JSON.stringify({
        timestamp: "2026-07-12T09:31:30.490Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1_040_000,
              cached_input_tokens: 910_000,
              output_tokens: 10_300,
              reasoning_output_tokens: 1_100,
              total_tokens: 1_050_300,
            },
          },
        },
      }),
    ].join("\n");

    const events = parseCodexJsonl(lines, { sourcePath: "/tmp/subagent-rollout.jsonl" });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sessionId: "subagent-session",
      model: "gpt-5.6-sol",
      inputTokens: 40_000,
      cachedInputTokens: 10_000,
      outputTokens: 300,
      reasoningOutputTokens: 100,
      totalTokens: 40_300,
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
