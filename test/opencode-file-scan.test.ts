import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("OpenCode file scan", () => {
  it("reads completed assistant usage from the OpenCode SQLite database", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-opencode-"));
    const opencodeHome = path.join(root, "opencode");
    await fs.mkdir(opencodeHome, { recursive: true });
    await fs.mkdir(path.join(root, "codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });

    const dbPath = path.join(opencodeHome, "opencode.db");
    const messageData = JSON.stringify({
      role: "assistant",
      modelID: "anthropic/claude-sonnet-4-6-20260217",
      time: { created: 1780974000000, completed: 1780974010000 },
      tokens: {
        input: 100,
        output: 20,
        reasoning: 5,
        cache: { read: 30, write: 7 },
      },
    }).replaceAll("'", "''");
    execFileSync("sqlite3", [
      dbPath,
      `
      CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, time_updated INTEGER);
      CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT);
      CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
      INSERT INTO session VALUES ('sess_1', 'proj_1', 1780974010000);
      INSERT INTO project VALUES ('proj_1', '${root.replaceAll("'", "''")}');
      INSERT INTO message VALUES ('msg_1', 'sess_1', 1780974000000, 1780974010000, '${messageData}');
      `,
    ]);

    process.env.CODEX_HOME = path.join(root, "codex");
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = opencodeHome;

    const result = await collectLocalUsage(root);

    expect(result.sources.find((source) => source.agent === "opencode")).toMatchObject({
      path: dbPath,
      files: 1,
      exists: true,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      agent: "opencode",
      model: "claude-sonnet-4-6",
      totalTokens: 162,
    });
  });
});
