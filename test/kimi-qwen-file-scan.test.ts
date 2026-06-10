import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("Kimi and Qwen file scan", () => {
  it("discovers Kimi wire logs and Qwen chat logs", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-kimi-qwen-"));
    const kimiHome = path.join(root, "kimi");
    const qwenHome = path.join(root, "qwen");
    await fs.mkdir(path.join(root, "codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
    await fs.mkdir(path.join(root, "opencode"), { recursive: true });
    await fs.mkdir(path.join(kimiHome, "sessions", "group", "session-a"), { recursive: true });
    await fs.mkdir(path.join(qwenHome, "projects", "repo", "chats"), { recursive: true });
    await fs.writeFile(path.join(kimiHome, "config.json"), JSON.stringify({ model: "kimi-k2" }));
    await fs.writeFile(
      path.join(kimiHome, "sessions", "group", "session-a", "wire.jsonl"),
      JSON.stringify({
        timestamp: 1770983427.123,
        message: {
          type: "StatusUpdate",
          payload: { token_usage: { input_other: 10, output: 5 } },
        },
      }),
    );
    await fs.writeFile(
      path.join(qwenHome, "projects", "repo", "chats", "chat.jsonl"),
      JSON.stringify({
        type: "assistant",
        timestamp: "2026-06-09T01:05:00.000Z",
        model: "qwen3-coder-plus",
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 7 },
      }),
    );

    process.env.CODEX_HOME = path.join(root, "codex");
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = path.join(root, "opencode");
    process.env.KIMI_DATA_DIR = kimiHome;
    process.env.QWEN_DATA_DIR = qwenHome;

    const result = await collectLocalUsage(root);

    expect(result.sources.find((source) => source.agent === "kimi")).toMatchObject({
      files: 1,
      exists: true,
    });
    expect(result.sources.find((source) => source.agent === "qwen")).toMatchObject({
      files: 1,
      exists: true,
    });
    expect(result.events.map((event) => event.agent).sort()).toEqual(["kimi", "qwen"]);
  });
});
