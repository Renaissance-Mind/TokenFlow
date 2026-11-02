import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";

const originalEnv = { ...process.env };
const homes: string[] = [];
afterEach(async () => { process.env = { ...originalEnv }; for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }); });
// Native SQLite and JSONL schemas from ccusage 72b8ad4 unified Claude Agent fixtures.
describe("OpenCode Claude Agent source deduplication", () => {
  it.each([
    ["linked", 156], ["missing", 156], ["empty", 156], ["sidechain", 187],
    ["next-day", 306], ["other-provider", 306], ["legacy", 306], ["copied-session", 156],
    ["copied-inline", 156], ["larger-copy", 256], ["main-after-sidechain", 156],
  ])("preserves accounting for %s source evidence", async (scenario, total) => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-native-link-")); homes.push(home);
    process.env = { PATH: originalEnv.PATH, HOME: home, TMPDIR: os.tmpdir(), CODEX_HOME: path.join(home, ".codex") };
    const claudeDir = path.join(home, ".claude/projects/project-a"), data = path.join(home, ".local/share/opencode");
    await fs.mkdir(claudeDir, { recursive: true }); await fs.mkdir(data, { recursive: true });
    const row = { timestamp: "2026-01-02T00:00:00Z", sessionId: "claude-native-a", requestId: "req-a", costUSD: 0.01,
      message: { id: "msg-a", model: "claude-sonnet-4-20250514", usage: { input_tokens: 100, output_tokens: 50 } } };
    if (scenario !== "missing") await fs.writeFile(path.join(claudeDir, "a.jsonl"), JSON.stringify(scenario === "empty"
      ? { sessionId: row.sessionId, type: "user", message: { role: "user", content: "hi" } }
      : scenario === "sidechain" || scenario === "main-after-sidechain" ? { ...row, isSidechain: true, message: { ...row.message, usage: { input_tokens: 30, output_tokens: 1 } } } : row));
    if (scenario === "copied-session") await fs.writeFile(path.join(claudeDir, "b.jsonl"), JSON.stringify({ ...row, sessionId: "claude-native-b" }));
    if (["copied-inline", "larger-copy", "main-after-sidechain"].includes(scenario)) await fs.appendFile(path.join(claudeDir, "a.jsonl"), "\n" + JSON.stringify({ ...row, sessionId: "claude-native-b",
      ...(scenario === "larger-copy" ? { message: { ...row.message, usage: { input_tokens: 200, output_tokens: 50 } } } : {}) }));
    const nativeSession = ["copied-session", "copied-inline", "larger-copy", "main-after-sidechain"].includes(scenario) ? "claude-native-b" : "claude-native-a";
    const wrapper = { time: { created: Date.parse(scenario === "next-day" ? "2026-01-03T00:00:00Z" : row.timestamp) }, model: { id: "opus", providerID: scenario === "other-provider" ? "anthropic" : "claude-agent" },
      content: [null, { native: 5 }, { native: { sessionID: " " } }, { native: { sessionID: nativeSession } }], tokens: { input: 100, output: 50 }, cost: 0 };
    const table = scenario === "legacy" ? "message" : "session_message";
    const quote = (value: object) => JSON.stringify(value).replaceAll("'", "''");
    execFileSync("sqlite3", [path.join(data, "opencode.db"), `CREATE TABLE ${table}(id TEXT,session_id TEXT,type TEXT,time_created INTEGER,data TEXT);
      INSERT INTO ${table} VALUES('agent','oc-session','assistant',1767312000000,'${quote(wrapper)}');
      INSERT INTO ${table} VALUES('plain','plain-session','assistant',1767312000000,'${quote({ time: { created: 1767312000000 }, model: { id: "gpt-5", providerID: "openai" }, tokens: { input: 5, output: 1 } })}');`]);
    const result = await collectLocalUsage(home);
    expect(result.events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(total);
    expect((await collectLocalUsage(home)).events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(total);
    const payload = JSON.stringify(toUsageSnapshotPayload(aggregateEvents(result.events)));
    expect(payload).not.toContain("claude-native-");
    expect(payload).not.toContain("nativeClaudeSessionId");
  });
});
