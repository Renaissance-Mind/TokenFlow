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

  it("reads ccusage-compatible OpenCode channel DBs and message JSON files", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-opencode-ccusage-"));
    const opencodeHome = path.join(root, "opencode");
    await fs.mkdir(path.join(opencodeHome, "storage", "message", "sess_file"), { recursive: true });
    await fs.mkdir(path.join(root, "codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });

    createOpenCodeDb(path.join(opencodeHome, "opencode-beta.db"), [
      {
        id: "msg_db",
        sessionId: "sess_db",
        created: 1780974000000,
        input: 10,
        output: 5,
      },
      {
        id: "msg_dupe",
        sessionId: "sess_db",
        created: 1780974060000,
        input: 20,
        output: 5,
      },
    ]);

    await fs.writeFile(
      path.join(opencodeHome, "storage", "message", "sess_file", "msg_file.json"),
      JSON.stringify({
        id: "msg_file",
        sessionID: "sess_file",
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
        time: { created: 1780974120000 },
        tokens: { input: 30, output: 5 },
      }),
    );
    await fs.writeFile(
      path.join(opencodeHome, "storage", "message", "sess_file", "msg_dupe.json"),
      JSON.stringify({
        id: "msg_dupe",
        sessionID: "sess_file",
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
        time: { created: 1780974180000 },
        tokens: { input: 999, output: 999 },
      }),
    );

    process.env.CODEX_HOME = path.join(root, "codex");
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_DATA_DIR = opencodeHome;

    const result = await collectLocalUsage(root);
    const opencodeEvents = result.events.filter((event) => event.agent === "opencode");

    expect(result.sources.find((source) => source.agent === "opencode")).toMatchObject({
      files: 2,
      exists: true,
    });
    expect(opencodeEvents.map((event) => [event.sessionId, event.inputTokens])).toEqual([
      ["sess_db", 10],
      ["sess_db", 20],
      ["sess_file", 30],
    ]);
  });
});

function createOpenCodeDb(
  dbPath: string,
  rows: Array<{ id: string; sessionId: string; created: number; input: number; output: number }>,
): void {
  const inserts = rows
    .map((row) => {
      const data = JSON.stringify({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
        time: { created: row.created },
        tokens: { input: row.input, output: row.output },
      }).replaceAll("'", "''");
      return `INSERT INTO message VALUES ('${row.id}', '${row.sessionId}', ${row.created}, ${row.created}, '${data}');`;
    })
    .join("\n");

  execFileSync("sqlite3", [
    dbPath,
    `
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    ${inserts}
    `,
  ]);
}
