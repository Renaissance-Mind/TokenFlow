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

describe("ccusage-compatible adapter file scan", () => {
  it("discovers phase one and phase two local usage sources", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-ccusage-adapters-"));
    const ampHome = path.join(root, "amp");
    const codebuffHome = path.join(root, "manicode");
    const droidHome = path.join(root, "droid");
    const gooseRoot = path.join(root, "goose");
    const hermesHome = path.join(root, "hermes");
    const kiloHome = path.join(root, "kilo");
    const openclawHome = path.join(root, "openclaw");
    const piHome = path.join(root, "pi-sessions");

    await fs.mkdir(path.join(root, "codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
    await fs.mkdir(path.join(root, "opencode"), { recursive: true });
    await fs.mkdir(path.join(ampHome, "threads"), { recursive: true });
    await fs.mkdir(path.join(codebuffHome, "projects", "project-a", "chats", "2026-01-02T03-04-05.000Z"), {
      recursive: true,
    });
    await fs.mkdir(droidHome, { recursive: true });
    await fs.mkdir(path.join(gooseRoot, "data", "sessions"), { recursive: true });
    await fs.mkdir(hermesHome, { recursive: true });
    await fs.mkdir(kiloHome, { recursive: true });
    await fs.mkdir(path.join(openclawHome, "agents", "main", "sessions"), { recursive: true });
    await fs.mkdir(path.join(piHome, "project-a"), { recursive: true });

    await fs.writeFile(
      path.join(ampHome, "threads", "thread-a.json"),
      JSON.stringify({
        id: "thread-a",
        messages: [
          {
            role: "assistant",
            usage: {
              model: "gpt-5",
              inputTokens: 1,
              outputTokens: 1,
              timestamp: "2026-01-02T00:05:00.000Z",
            },
          },
        ],
      }),
    );
    await fs.writeFile(
      path.join(codebuffHome, "projects", "project-a", "chats", "2026-01-02T03-04-05.000Z", "chat-messages.json"),
      JSON.stringify([
        {
          role: "assistant",
          timestamp: "2026-01-02T03:04:06.000Z",
          metadata: { model: "gpt-5", usage: { inputTokens: 1, outputTokens: 1 } },
        },
      ]),
    );
    await fs.writeFile(
      path.join(droidHome, "session-a.settings.json"),
      JSON.stringify({
        model: "gpt-5",
        providerLockTimestamp: "2026-05-01T01:02:03.000Z",
        tokenUsage: { inputTokens: 1, outputTokens: 1 },
      }),
    );
    await fs.writeFile(
      path.join(openclawHome, "agents", "main", "sessions", "abc.jsonl"),
      JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          model: "gpt-5",
          usage: { input: 1, output: 1 },
          timestamp: "2026-01-30T08:58:55.279Z",
        },
      }),
    );
    await fs.writeFile(
      path.join(piHome, "project-a", "agent_session-a.jsonl"),
      JSON.stringify({
        type: "message",
        timestamp: "2026-01-02T00:00:00.000Z",
        message: { role: "assistant", model: "gpt-5", usage: { input: 1, output: 1 } },
      }),
    );

    createGooseDb(path.join(gooseRoot, "data", "sessions", "sessions.db"));
    createHermesDb(path.join(hermesHome, "state.db"));
    createKiloDb(path.join(kiloHome, "kilo.db"));

    process.env.CODEX_HOME = path.join(root, "codex");
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = path.join(root, "opencode");
    process.env.AMP_DATA_DIR = ampHome;
    process.env.CODEBUFF_DATA_DIR = codebuffHome;
    process.env.DROID_SESSIONS_DIR = droidHome;
    process.env.GOOSE_PATH_ROOT = gooseRoot;
    process.env.HERMES_HOME = hermesHome;
    process.env.KILO_DATA_DIR = kiloHome;
    process.env.OPENCLAW_DIR = openclawHome;
    process.env.PI_AGENT_DIR = piHome;

    const result = await collectLocalUsage(root);

    const newAgents = ["amp", "codebuff", "droid", "goose", "hermes", "kilo", "openclaw", "pi"];
    expect(result.events.map((event) => event.agent).filter((agent) => newAgents.includes(agent)).sort()).toEqual(
      newAgents,
    );
    for (const agent of newAgents) {
      expect(result.sources.find((source) => source.agent === agent)).toMatchObject({
        files: 1,
        exists: true,
      });
    }
  });
});

function createGooseDb(dbPath: string): void {
  execFileSync("sqlite3", [
    dbPath,
    `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      model_config_json TEXT,
      provider_name TEXT,
      created_at TEXT,
      total_tokens INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      accumulated_total_tokens INTEGER,
      accumulated_input_tokens INTEGER,
      accumulated_output_tokens INTEGER
    );
    INSERT INTO sessions VALUES (
      'goose-session',
      '{"model_name":"gpt-5"}',
      'openai',
      '2026-05-01 01:02:03',
      NULL,
      NULL,
      NULL,
      2,
      1,
      1
    );
    `,
  ]);
}

function createHermesDb(dbPath: string): void {
  execFileSync("sqlite3", [
    dbPath,
    `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      model TEXT,
      started_at REAL NOT NULL,
      message_count INTEGER DEFAULT 0,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_write_tokens INTEGER DEFAULT 0,
      reasoning_tokens INTEGER DEFAULT 0,
      billing_provider TEXT,
      estimated_cost_usd REAL,
      actual_cost_usd REAL
    );
    INSERT INTO sessions VALUES (
      'hermes-session',
      'cli',
      'gpt-5',
      1750000000.25,
      1,
      1,
      1,
      0,
      0,
      0,
      'openai',
      NULL,
      NULL
    );
    `,
  ]);
}

function createKiloDb(dbPath: string): void {
  const data = JSON.stringify({
    id: "kilo-message",
    role: "assistant",
    providerID: "openai",
    modelID: "gpt-5",
    time: { created: 1767312000000 },
    tokens: { input: 1, output: 1 },
  }).replaceAll("'", "''");
  execFileSync("sqlite3", [
    dbPath,
    `
    CREATE TABLE message (id TEXT, session_id TEXT, data TEXT);
    INSERT INTO message VALUES ('row-1', 'kilo-session', '${data}');
    `,
  ]);
}
