import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { collectLocalUsage } from "../src/file-scan.js";
import { aggregateEvents } from "../src/usage-buckets.js";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("JSONL file scan", () => {
  it("streams Codex rollout files instead of reading the whole file into one string", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-codex-stream-"));
    const codexHome = path.join(root, "codex");
    await fs.mkdir(path.join(codexHome, "sessions", "2026", "06", "09"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
    await fs.mkdir(path.join(root, "opencode"), { recursive: true });

    const file = path.join(
      codexHome,
      "sessions",
      "2026",
      "06",
      "09",
      "rollout-2026-06-09T01-00-00-test.jsonl",
    );
    await fs.writeFile(
      file,
      [
        JSON.stringify({ type: "session_meta", payload: { session_id: "codex-session" } }),
        JSON.stringify({ type: "turn_context", payload: { model: "OpenAI/GPT-5.2-Codex@HIGH" } }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-09T01:05:00.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 30,
                reasoning_output_tokens: 5,
              },
            },
          },
        }),
      ].join("\n"),
    );

    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = path.join(root, "opencode");
    vi.spyOn(fs, "readFile").mockRejectedValue(new RangeError("Invalid string length"));

    const result = await collectLocalUsage(root);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      agent: "codex",
      sessionId: "codex-session",
      model: "gpt-5.2-codex-high",
      totalTokens: 155,
    });
  });

  it("applies Codex fast service tier pricing from CODEX_HOME config", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-codex-fast-"));
    const codexHome = path.join(root, "codex");
    await fs.mkdir(path.join(codexHome, "sessions", "2026", "06", "09"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
    await fs.mkdir(path.join(root, "opencode"), { recursive: true });
    await fs.writeFile(path.join(codexHome, "config.toml"), 'service_tier = "priority"\n');

    await fs.writeFile(
      path.join(codexHome, "sessions", "2026", "06", "09", "rollout-2026-06-09T01-00-00-test.jsonl"),
      [
        JSON.stringify({ type: "session_meta", payload: { session_id: "codex-session" } }),
        JSON.stringify({ type: "turn_context", payload: { model: "OpenAI/GPT-5.4" } }),
        JSON.stringify({
          type: "event_msg",
          timestamp: "2026-06-09T01:05:00.000Z",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 1_000_000,
                output_tokens: 0,
              },
            },
          },
        }),
      ].join("\n"),
    );

    process.env.CODEX_HOME = codexHome;
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = path.join(root, "opencode");

    const result = await collectLocalUsage(root);
    const buckets = aggregateEvents(result.events);

    expect(result.events[0]).toMatchObject({
      agent: "codex",
      model: "gpt-5.4",
      costMultiplier: "2",
    });
    expect(buckets[0]).toMatchObject({
      model: "gpt-5.4",
      cost: {
        inputUsd: "10.000000",
        totalUsd: "10.000000",
      },
    });
  });

  it("streams Claude project JSONL files instead of reading the whole file into one string", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-claude-stream-"));
    const claudeHome = path.join(root, "claude");
    await fs.mkdir(path.join(root, "codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(claudeHome, "projects", "repo"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
    await fs.mkdir(path.join(root, "opencode"), { recursive: true });

    await fs.writeFile(
      path.join(claudeHome, "projects", "repo", "session.jsonl"),
      JSON.stringify({
        timestamp: "2026-06-09T02:12:00.000Z",
        requestId: "req-1",
        message: {
          id: "msg-1",
          model: "claude-sonnet-4-6-20260217",
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
            output_tokens: 30,
          },
        },
      }),
    );

    process.env.CODEX_HOME = path.join(root, "codex");
    process.env.CLAUDE_HOME = claudeHome;
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = path.join(root, "opencode");
    vi.spyOn(fs, "readFile").mockRejectedValue(new RangeError("Invalid string length"));

    const result = await collectLocalUsage(root);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      agent: "claude",
      model: "claude-sonnet-4-6",
      totalTokens: 160,
    });
  });
});
