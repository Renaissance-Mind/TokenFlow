import { describe, expect, it } from "vitest";

import { parseAmpThread } from "../src/sources/amp.js";
import { parseCodebuffChatMessages } from "../src/sources/codebuff.js";
import { parseDroidSettings } from "../src/sources/droid.js";
import { parseGooseSessionRow } from "../src/sources/goose.js";
import { parseHermesSessionRow } from "../src/sources/hermes.js";
import { parseKiloMessageRow } from "../src/sources/kilo.js";
import { parseOpenClawJsonl } from "../src/sources/openclaw.js";
import { parsePiJsonl } from "../src/sources/pi.js";

describe("ccusage-compatible adapter parsers", () => {
  it("reads Pi assistant usage JSONL and falls totalTokens back to output", () => {
    const events = parsePiJsonl(
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-02T00:00:00.000Z",
        message: {
          role: "assistant",
          model: "gpt-5",
          usage: { totalTokens: 333, cost: { total: 0.0123 } },
        },
      }),
      { sourcePath: "/tmp/.pi/agent/sessions/project-a/agent_session-a.jsonl" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "pi",
      model: "gpt-5",
      sessionId: "session-a",
      timestamp: "2026-01-02T00:00:00.000Z",
      bucketStart: "2026-01-02T00:00:00.000Z",
      outputTokens: 333,
      totalTokens: 333,
      recordedCostUsd: "0.0123",
    });
  });

  it("uses OpenClaw model_change state for following assistant usage rows", () => {
    const events = parseOpenClawJsonl(
      [
        JSON.stringify({ type: "model_change", provider: "openai-codex", modelId: "gpt-5.2" }),
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            usage: { input: 1660, output: 55, cacheRead: 108928, cost: { total: 0.02 } },
            timestamp: 1769753935279,
          },
        }),
      ].join("\n"),
      { sourcePath: "/tmp/.openclaw/agents/main/sessions/abc.jsonl" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "openclaw",
      model: "gpt-5.2",
      sessionId: "abc",
      timestamp: "2026-01-30T06:18:55.279Z",
      inputTokens: 1660,
      cachedInputTokens: 108928,
      outputTokens: 55,
      totalTokens: 110643,
      recordedCostUsd: "0.02",
    });
  });

  it("reads Amp ledger events with cache token details from matching messages", () => {
    const events = parseAmpThread(
      JSON.stringify({
        id: "thread-a",
        usageLedger: {
          events: [
            {
              id: "event-a",
              timestamp: "2026-01-02T00:05:00.000Z",
              model: "claude-haiku-4-5-20251001",
              tokens: { input: 100, output: 50 },
              toMessageId: 7,
            },
          ],
        },
        messages: [
          {
            role: "assistant",
            messageId: 7,
            usage: {
              cacheCreationInputTokens: 20,
              cacheReadInputTokens: 10,
            },
          },
        ],
      }),
      { sourcePath: "/tmp/.local/share/amp/threads/thread-a.json" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "amp",
      model: "claude-haiku-4-5",
      sessionId: "thread-a",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 20,
      cachedInputTokens: 10,
      totalTokens: 180,
    });
  });

  it("reads Amp message usage when usageLedger is absent", () => {
    const events = parseAmpThread(
      JSON.stringify({
        id: "T-thread-b",
        messages: [
          { role: "user", content: "hi" },
          {
            role: "assistant",
            usage: {
              model: "claude-haiku-4-5-20251001",
              inputTokens: 10,
              outputTokens: 178,
              cacheCreationInputTokens: 986,
              cacheReadInputTokens: 11372,
              timestamp: "2026-01-19T11:42:10.652Z",
            },
          },
        ],
      }),
      { sourcePath: "/tmp/.local/share/amp/threads/thread-b.json" },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      agent: "amp",
      model: "claude-haiku-4-5",
      sessionId: "T-thread-b",
      timestamp: "2026-01-19T11:42:10.652Z",
      inputTokens: 10,
      outputTokens: 178,
      cacheCreationTokens: 986,
      cachedInputTokens: 11372,
      totalTokens: 12546,
    });
  });

  it("reads Codebuff metadata usage and runState provider usage", () => {
    const events = parseCodebuffChatMessages(
      JSON.stringify([
        {
          id: "assistant-message",
          role: "assistant",
          timestamp: "2026-01-02T03:04:06.000Z",
          metadata: {
            model: "claude-sonnet-4-20250514",
            usage: {
              inputTokens: 100,
              outputTokens: 50,
              cacheCreationInputTokens: 20,
              cacheReadInputTokens: 10,
            },
          },
        },
        {
          variant: "agent",
          metadata: {
            runState: {
              sessionState: {
                mainAgentState: {
                  messageHistory: [
                    { role: "user", providerOptions: {} },
                    {
                      role: "assistant",
                      providerOptions: {
                        codebuff: {
                          model: "openai/gpt-5",
                          usage: {
                            prompt_tokens: 12,
                            completion_tokens: 6,
                            prompt_tokens_details: { cached_tokens: 3 },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ]),
      {
        sourcePath: "/tmp/manicode/projects/project-a/chats/2026-01-02T03-04-05.000Z/chat-messages.json",
      },
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      agent: "codebuff",
      model: "claude-sonnet-4",
      sessionId: "manicode/project-a/2026-01-02T03-04-05.000Z",
      inputTokens: 100,
      outputTokens: 50,
      cacheCreationTokens: 20,
      cachedInputTokens: 10,
      totalTokens: 180,
    });
    expect(events[1]).toMatchObject({
      agent: "codebuff",
      model: "gpt-5",
      inputTokens: 12,
      outputTokens: 6,
      cachedInputTokens: 3,
      totalTokens: 21,
    });
  });

  it("normalizes Droid settings model names and maps thinking tokens to reasoning output", () => {
    const event = parseDroidSettings(
      JSON.stringify({
        model: "Claude-Sonnet-4-[Anthropic]",
        providerLock: "anthropic",
        providerLockTimestamp: "2026-05-01T01:02:03.000Z",
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheCreationTokens: 20,
          cacheReadTokens: 10,
          thinkingTokens: 5,
        },
      }),
      { sourcePath: "/tmp/.factory/sessions/session-a.settings.json" },
    );

    expect(event).toMatchObject({
      agent: "droid",
      model: "claude-sonnet-4",
      sessionId: "session-a",
      timestamp: "2026-05-01T01:02:03.000Z",
      inputTokens: 100,
      outputTokens: 50,
      reasoningOutputTokens: 5,
      cacheCreationTokens: 20,
      cachedInputTokens: 10,
      totalTokens: 185,
    });
  });

  it("reads Goose accumulated session usage and derives reasoning from total", () => {
    const event = parseGooseSessionRow(
      {
        id: "session-a",
        model_config_json: '{"model_name":"claude-sonnet-4-20250514"}',
        provider_name: "anthropic",
        created_at: "2026-05-01 01:02:03",
        total_tokens: null,
        input_tokens: null,
        output_tokens: null,
        accumulated_total_tokens: 180,
        accumulated_input_tokens: 100,
        accumulated_output_tokens: 50,
      },
      "sessions.db",
    );

    expect(event).toMatchObject({
      agent: "goose",
      model: "claude-sonnet-4",
      sessionId: "session-a",
      timestamp: "2026-05-01T01:02:03.000Z",
      inputTokens: 100,
      outputTokens: 50,
      reasoningOutputTokens: 30,
      totalTokens: 180,
    });
  });

  it("reads Hermes state rows and preserves positive recorded costs", () => {
    const event = parseHermesSessionRow(
      {
        id: "session-1",
        model: "claude-sonnet-4-20250514",
        billing_provider: "anthropic",
        started_at: 1_750_000_000.25,
        message_count: 42,
        input_tokens: 1200,
        output_tokens: 300,
        cache_read_tokens: 50,
        cache_write_tokens: 20,
        reasoning_tokens: 10,
        estimated_cost_usd: 0.12,
        actual_cost_usd: 0.34,
      },
      "state.db",
    );

    expect(event).toMatchObject({
      agent: "hermes",
      model: "claude-sonnet-4",
      sessionId: "session-1",
      timestamp: "2025-06-15T15:06:40.250Z",
      inputTokens: 1200,
      outputTokens: 300,
      cachedInputTokens: 50,
      cacheCreationTokens: 20,
      reasoningOutputTokens: 10,
      totalTokens: 1580,
      recordedCostUsd: "0.34",
    });
  });

  it("ignores Hermes recorded zero costs so pricing can fall back to tokens", () => {
    const event = parseHermesSessionRow(
      {
        id: "subscription-included",
        model: "gpt-5.5",
        billing_provider: "openai",
        started_at: 1_750_000_000.25,
        input_tokens: 1000,
        output_tokens: 100,
        reasoning_tokens: 10,
        estimated_cost_usd: 0,
        actual_cost_usd: 0,
      },
      "state.db",
    );

    expect(event).toMatchObject({
      agent: "hermes",
      model: "gpt-5.5",
      totalTokens: 1110,
    });
    expect(event?.recordedCostUsd).toBeUndefined();
  });

  it("reads Kilo assistant messages from SQLite rows", () => {
    const event = parseKiloMessageRow(
      {
        id: "row-1",
        session_id: "session-a",
        data: JSON.stringify({
          id: "msg-1",
          role: "assistant",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          time: { created: 1767312000000 },
          tokens: { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 20 } },
          cost: 0.02,
        }),
      },
      "/tmp/kilo.db",
    );

    expect(event).toMatchObject({
      agent: "kilo",
      model: "claude-sonnet-4",
      sessionId: "session-a",
      timestamp: "2026-01-02T00:00:00.000Z",
      inputTokens: 100,
      outputTokens: 50,
      reasoningOutputTokens: 5,
      cacheCreationTokens: 20,
      cachedInputTokens: 10,
      totalTokens: 185,
      recordedCostUsd: "0.02",
    });
  });
});
