import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { parseCodexJsonl } from "../src/sources/codex.js";
import { dedupeCodexSessions } from "../src/sources/codex-replay.js";
const env = { ...process.env }, homes: string[] = [];
afterEach(async () => { process.env = { ...env }; for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }); });
async function home() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-nov10-")); homes.push(root);
  process.env = { PATH: env.PATH, HOME: root, TMPDIR: os.tmpdir(), CODEX_HOME: path.join(root, ".codex") }; return root;
}
it.each([true, false])("handles fork-instant request records only for spawned children: %s", async spawned => {
  const root = await home(), dir = path.join(root, ".codex/sessions"); await fs.mkdir(dir, { recursive: true });
  const fixture = await fs.readFile(new URL("./fixtures/codex-issue-2046.jsonl", import.meta.url), "utf8");
  const rows = fixture.trim().split("\n").map(line => JSON.parse(line));
  if (!spawned) delete rows[0].payload.source.subagent;
  await fs.writeFile(path.join(dir, "rollout-child.jsonl"), rows.map(row => JSON.stringify(row)).join("\n"));
  const events = (await collectLocalUsage(root)).events.filter(event => event.agent === "codex");
  expect(events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(spawned ? 20200 : 0);
  if (spawned) expect(events.map(event => event.totalTokens)).toEqual([10100, 10100]);
});
it("keeps repeated identical requests within one rollout while deduplicating copied ordinals", () => {
  const rows = [0, 1].map(() => JSON.stringify({ type: "event_msg", timestamp: "2026-11-01T00:00:00Z", payload: { type: "token_count", info: { model: "gpt-5", last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } }));
  const events = parseCodexJsonl(rows.join("\n"), { sourcePath: "/fixture/a.jsonl" });
  const sessions = ["a", "b"].map(file => ({ id: "same-session", events: events.map(event => ({ ...event, sourcePath: `/fixture/${file}.jsonl` })), compactions: new Map<string, string>() }));
  expect(dedupeCodexSessions(sessions).map(event => event.totalTokens)).toEqual([110, 110]);
  sessions[0].events[0].recordedServiceTier = sessions[0].events[0].serviceTier = "fast";
  sessions[0].events[1].recordedServiceTier = sessions[0].events[1].serviceTier = "standard";
  sessions[1].events[0].recordedServiceTier = sessions[1].events[0].serviceTier = "ultrafast";
  sessions[1].events[1].recordedServiceTier = sessions[1].events[1].serviceTier = "flex";
  expect(dedupeCodexSessions(sessions).map(event => event.serviceTier)).toEqual(["ultrafast", "standard"]);
  expect(sessions[0].events[0].serviceTier).toBe("fast");
});
it("retains a resumed spawned child's own record-less requests before its first usage record", async () => {
  const root = await home(), dir = path.join(root, ".codex/sessions"); await fs.mkdir(dir, { recursive: true });
  const rows = (await fs.readFile(new URL("./fixtures/codex-issue-2046.jsonl", import.meta.url), "utf8")).trim().split("\n").map(line => JSON.parse(line));
  rows[3] = { ...rows[3], timestamp: "2026-11-01T09:42:12Z", payload: { type: "token_count", info: { model: "gpt-6-astra", last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } };
  for (let index = 4; index < rows.length; index++) rows[index].timestamp = index % 2 ? "2026-11-03T09:42:10.723Z" : "2026-11-03T09:42:09.923Z";
  await fs.writeFile(path.join(dir, "rollout-resumed.jsonl"), rows.map(row => JSON.stringify(row)).join("\n"));
  expect((await collectLocalUsage(root)).events.filter(event => event.agent === "codex").map(event => event.totalTokens)).toEqual([110, 10100, 10100]);
});
it.each([["assistant", 174, 2], ["aggregate", 174, 1], ["fork", 186, 3]] as const)("counts completed OpenCode compactions with %s evidence", async (scenario, expected, count) => {
  const assistant = scenario !== "aggregate";
  const root = await home(), dir = path.join(root, ".local/share/opencode"); await fs.mkdir(dir, { recursive: true });
  const compaction = { status: "completed", model: { id: "gpt-5", providerID: "openai" }, time: { created: 1767312000000 }, tokens: { input: 100, output: 20, reasoning: 7, cache: { read: 30, write: 5 } }, cost: 0.02 };
  const quote = (row: object) => JSON.stringify(row).replaceAll("'", "''");
  execFileSync("sqlite3", [path.join(dir, "opencode.db"), `CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,data TEXT);
    CREATE TABLE session_v2(id TEXT,time_created INTEGER,model TEXT,cost REAL,tokens_input INTEGER,tokens_output INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER,tokens_reasoning INTEGER,fork_session_id TEXT,fork_boundary TEXT);
    INSERT INTO session_v2 VALUES('s',1767312000000,'gpt-5',0.03,110,22,30,5,7,NULL,NULL);
    INSERT INTO session_message VALUES('compact','s','compaction',1,1767312000000,'${quote(compaction)}');
    INSERT INTO session_message VALUES('running','s','compaction',2,1767312000000,'${quote({ ...compaction, status: "running" })}');
    ${assistant ? `INSERT INTO session_message VALUES('assistant','s','assistant',0,1767312000000,'${quote({ model: { id: "gpt-5", providerID: "openai" }, tokens: { input: 10, output: 2 }, cost: 0.01 })}');` : ""}
    ${scenario === "fork" ? `INSERT INTO session_v2 VALUES('child',1767312000000,'gpt-5',0.04,120,24,30,5,7,'s','{"type":"through","messageID":"compact"}');
      INSERT INTO session_message SELECT 'copy-'||id,'child',type,seq,time_created,data FROM session_message WHERE id IN ('assistant','compact');
      INSERT INTO session_message SELECT 'own','child',type,2,time_created,data FROM session_message WHERE id='assistant';` : ""}`]);
  const events = (await collectLocalUsage(root)).events.filter(event => event.agent === "opencode");
  expect(events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(expected);
  expect(events).toHaveLength(count);
  expect(events.reduce((sum, event) => sum + Number(event.recordedCostUsd), 0)).toBeCloseTo(scenario === "fork" ? 0.04 : 0.03);
});
