import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { parseClaudeJsonl } from "../src/sources/claude.js";
import { parseCodexJsonl } from "../src/sources/codex.js";
import { mergeOpenClawStores } from "../src/sources/openclaw.js";
import { timestampFromNumber } from "../src/sources/ccusage-common.js";
import { collectCopilot } from "../src/sources/copilot.js";
import { collectGrok } from "../src/sources/grok.js";
import { sourceName, withSourceDiagnostics } from "../src/source-input.js";
import { cachedSource, withCollectionCache } from "../src/collection-cache.js";
import { sqliteRows } from "../src/sources/store-io.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";

const env = { ...process.env }, roots: string[] = [];
afterEach(async () => { process.env = { ...env }; for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-nov20-")); roots.push(root);
  process.env = { PATH: env.PATH, TMPDIR: os.tmpdir() }; return root;
}
async function put(root: string, name: string, content: string) {
  const file = path.join(root, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); return file;
}
const jsonl = (...rows: object[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
const claude = { timestamp: "2026-11-20T09:00:00Z", requestId: "req-progress", message: { id: "msg-progress", model: "claude-sonnet-4-20250514", usage: {
  input_tokens: 7, output_tokens: 2, iterations: [{ type: "advisor_message", model: "claude-opus-4-6", input_tokens: 3, output_tokens: 2 }],
} } };
it("reads nested Claude progress and prices advisor calls separately without duplicate copies", () => {
  const events = parseClaudeJsonl(jsonl({ sessionId: "parent", data: { message: claude } }, { ...claude, sessionId: "parent" }), { sourcePath: "/fixture/claude.jsonl" });
  expect(events.map(event => [event.model, event.totalTokens])).toEqual([["claude-sonnet-4", 9], ["claude-opus-4-6", 5]]);
  expect(JSON.stringify(toUsageSnapshotPayload(aggregateEvents(events)))).not.toMatch(/req-progress|msg-progress/);
});
it("does not advance a Codex cumulative baseline from a rejected timestamp", () => {
  const row = (timestamp: string, input: number) => ({ type: "event_msg", timestamp, payload: { type: "token_count", info: { model: "gpt-5", total_token_usage: { input_tokens: input, output_tokens: 0, total_tokens: input } } } });
  expect(parseCodexJsonl(jsonl(row("invalid", 100), row("2026-11-20T09:00:00Z", 300)), { sourcePath: "/fixture/codex.jsonl" }).map(event => event.totalTokens)).toEqual([300]);
});
it("deduplicates a recorded Codex call across session copies without merging distinct request IDs", async () => {
  const root = await sandbox();
  const request = (session: string, id: string) => jsonl(
    { type: "session_meta", timestamp: "2026-11-20T09:00:00Z", payload: { id: session } },
    { type: "token_usage_record", timestamp: "2026-11-20T09:01:00Z", payload: { response_id: id, model: "gpt-5", usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } },
    { type: "event_msg", timestamp: "2026-11-20T09:01:00Z", payload: { type: "token_count", info: { model: "gpt-5", last_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } } } },
  );
  await put(root, ".codex/sessions/rollout-a.jsonl", request("a", "response-1"));
  await put(root, ".codex/sessions/rollout-b.jsonl", request("b", "response-1"));
  await put(root, ".codex/sessions/rollout-c.jsonl", request("c", "response-2"));
  const events = (await collectLocalUsage(root)).events;
  expect(events.map(event => event.totalTokens)).toEqual([110, 110]);
  expect(JSON.stringify(toUsageSnapshotPayload(aggregateEvents(events)))).not.toContain("response-1");
});
it.each([false, true])("preserves separate recordless and recorded Codex calls with partial copies in either order: %s", async reverse => {
  const root = await sandbox();
  const timestamp = "2026-11-20T09:00:00Z", usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110 };
  const meta = { type: "session_meta", timestamp, payload: { id: "logical-session" } };
  const token = { type: "event_msg", timestamp, payload: { type: "token_count", info: { model: "gpt-5", last_token_usage: usage } } };
  const record = { type: "token_usage_record", timestamp, payload: { response_id: "recorded-call", model: "gpt-5", usage } };
  await put(root, `.codex/sessions/rollout-${reverse ? "b" : "a"}.jsonl`, jsonl(meta, record, token, token));
  await put(root, `.codex/sessions/rollout-${reverse ? "a" : "b"}.jsonl`, jsonl(meta, token));
  expect((await collectLocalUsage(root)).events.map(event => event.totalTokens)).toEqual([110, 110]);
});
it("lets distinct SQLite OpenClaw events replace all JSONL copies without replacing each other", () => {
  const event = { agent: "openclaw" as const, model: "gpt-5", sessionId: "s", sourcePath: "/fixture/log.jsonl", timestamp: "2026-11-20T09:00:00Z", bucketStart: "2026-11-20T09:00:00.000Z", inputTokens: 100, outputTokens: 10, cachedInputTokens: 0, cacheCreationTokens: 0, reasoningOutputTokens: 0, totalTokens: 110 };
  const legacy = [0.5, 0.75].map(cost => ({ ...event, recordedCostUsd: String(cost) }));
  const database = ["first", "second"].map(messageId => ({ ...event, sourcePath: "/fixture/db.sqlite", messageId }));
  expect(mergeOpenClawStores(legacy, database).map(event => event.messageId)).toEqual(["first", "second"]);
});
it("rejects microsecond and out-of-range epoch values without throwing", () => {
  expect(timestampFromNumber(1795165200000000)).toBeNull();
  expect(timestampFromNumber(Number.MAX_SAFE_INTEGER)).toBeNull();
  expect(timestampFromNumber(1795165200)).toBe("2026-11-20T09:00:00.000Z");
});
it("keeps healthy usage beside malformed JSONL, reports it on cached scans, and excludes partial coverage", async () => {
  const root = await sandbox();
  const row = { type: "assistant", model: "qwen3-coder-plus", sessionId: "s", timestamp: "2026-11-20T09:00:00Z", usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
  const file = await put(root, ".qwen/projects/p/chats/session.jsonl", '{"usageMetadata":BROKEN_SECRET}\n' + jsonl(row));
  for (let pass = 0; pass < 2; pass++) {
    if (pass) await put(root, ".claude/projects/p/other.jsonl", jsonl({ timestamp: "2026-11-20T09:00:00Z", message: { model: "claude-sonnet-4", usage: { input_tokens: 1, output_tokens: 0 } } }));
    const result = await collectLocalUsage(root);
    expect(result.events.filter(event => event.agent === "qwen").map(event => event.totalTokens)).toEqual([15]);
    expect(result.scannedFiles).not.toContain(file);
    expect(result.sources.find(source => source.agent === "qwen")?.warnings?.join(" ")).toContain("invalid JSON");
    expect(JSON.stringify(result.sources)).not.toContain("BROKEN_SECRET");
  }
});
it("reads symlinked logs and custom tilde roots once while stopping directory cycles", async () => {
  const root = await sandbox();
  const row = { ...claude, message: { ...claude.message, usage: { input_tokens: 7, output_tokens: 2 } }, sessionId: "s" };
  const actual = await put(root, "archive/log.jsonl", jsonl(row));
  await fs.mkdir(path.join(root, "custom/projects/p"), { recursive: true });
  await fs.symlink(actual, path.join(root, "custom/projects/p/linked.jsonl"));
  await fs.symlink(path.join(root, "custom/projects"), path.join(root, "custom/projects/p/cycle"));
  process.env.CLAUDE_CONFIG_DIR = "~/custom";
  expect((await collectLocalUsage(root)).events.map(event => event.totalTokens)).toEqual([9]);
});
it("keeps Copilot OTel call identities structural across exported files", async () => {
  const root = await sandbox();
  const attributes = { "gen_ai.response.model": "gpt-5.4", "gen_ai.usage.input_tokens": 10, "gen_ai.usage.output_tokens": 5 };
  await put(root, ".copilot/otel/a.jsonl", jsonl({ type: "span", traceId: "log:T", spanId: "S", name: "chat gpt-5.4", endTime: [1795165200, 0], attributes }));
  await put(root, ".copilot/otel/b.jsonl", jsonl({ type: "log", traceId: "T", spanId: "S", timestamp: 1795165200000, attributes: { ...attributes, "event.name": "gen_ai.client.inference.operation.details" } }));
  expect((await collectCopilot(root)).events.map(event => event.totalTokens)).toEqual([15, 15]);
});
it("reports undated native Copilot calls while retaining dated calls and excluding partial coverage", async () => {
  const root = await sandbox();
  const usage = { model: "gpt-5.4", inputTokens: 10, outputTokens: 5 };
  const file = await put(root, ".copilot/session-state/s/events.jsonl", jsonl(
    { type: "session.usage_record", id: "undated", timestamp: "invalid", data: { usage } },
    { type: "session.usage_record", id: "dated", timestamp: "2026-11-20T09:00:00Z", data: { usage } },
  ));
  for (let pass = 0; pass < 2; pass++) {
    const result = await collectLocalUsage(root);
    expect(result.events.map(event => event.totalTokens)).toEqual([15]);
    expect(result.scannedFiles).not.toContain(file);
    expect(result.sources.find(source => source.agent === "copilot")?.warnings?.join(" ")).toMatch(/invalid usage timestamp/);
  }
});
it.each([[5, 2, 0.2], [null, 2, 0], [5, 3, 0]] as const)("reconciles watermarked Copilot receipts with credits %s and watermark %s", async (secondCredit, watermark, expectedGap) => {
  const root = await sandbox();
  const receipt = (sequence: number, credits: number | null) => ({ type: "session.usage_record", id: `r${sequence}`, timestamp: `2026-01-0${sequence + 1}T09:00:00Z`, data: { usage: {
    model: "gpt-5.4", inputTokens: 100, apiCallId: `response-${sequence}`, accounting: { sourceSessionId: "session-1", sequence }, copilotUsage: { totalNanoAiu: credits === null ? null : credits * 1e9 },
  } } });
  const checkpoint = (day: number, total: number, sequence: number) => ({ type: "session.usage_checkpoint", id: `checkpoint-${day}`, timestamp: `2026-01-0${day}T10:00:00Z`, data: { totalNanoAiu: total * 1e9, usageAccountingWatermarks: { "session-1": sequence } } });
  await put(root, ".copilot/session-state/session-1/events.jsonl", jsonl(
    { type: "session.shutdown", id: "legacy", timestamp: "2026-01-01T09:00:00Z", data: { totalNanoAiu: 4e9, modelMetrics: { "gpt-5.4": { usage: { inputTokens: 100, outputTokens: 50 }, totalNanoAiu: 4e9 } } } },
    receipt(1, 10), checkpoint(2, 14, 1), receipt(2, secondCredit), checkpoint(3, 39, watermark),
  ));
  await put(root, ".copilot/session-state/copy/events.jsonl", jsonl(receipt(1, 10)));
  const events = (await collectCopilot(root)).events;
  expect(events.filter(event => event.model === "unknown").reduce((sum, event) => sum + Number(event.recordedCostUsd), 0)).toBeCloseTo(expectedGap);
  expect(events.filter(event => event.totalTokens > 0).map(event => event.totalTokens)).toEqual([150, 100, 100]);
});
it("preserves distinct byte identities and filename suffixes for invalid UTF-8 names", () => {
  const names = [Buffer.from([0xfe]), Buffer.from([0xff]), Buffer.from("�")].map(bytes => Buffer.concat([Buffer.from("project-"), bytes, Buffer.from(".jsonl")]));
  expect(new Set(names.map(sourceName)).size).toBe(3);
  expect(names.map(sourceName).every(name => name.endsWith(".jsonl"))).toBe(true);
});
it("retains healthy OpenCode rows and reports corrupt SQLite inputs without exposing their content", async () => {
  const root = await sandbox(), directory = path.join(root, ".local/share/opencode");
  await fs.mkdir(directory, { recursive: true });
  const db = path.join(directory, "opencode.db"), bad = path.join(directory, "opencode-corrupt.db");
  await fs.writeFile(bad, "SECRET_CORRUPT_DATABASE");
  const data = JSON.stringify({ role: "assistant", modelID: "gpt-5", time: { created: 1795165200000, completed: 1795165201000 }, tokens: { input: 10, output: 5 } });
  execFileSync("sqlite3", [db, `CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO message VALUES('healthy','s',1795165200000,'${data}'); INSERT INTO message VALUES('broken','s',1795165200000,'SECRET_INVALID_JSON');`]);
  for (let pass = 0; pass < 2; pass++) {
    const result = await collectLocalUsage(root);
    expect(result.events.map(event => event.totalTokens)).toEqual([15]);
    expect(result.scannedFiles).not.toContain(db);
    expect(result.scannedFiles).not.toContain(bad);
    const warnings = result.sources.find(source => source.agent === "opencode")?.warnings?.join(" ");
    expect(warnings).toMatch(/invalid JSON/);
    expect(warnings).toMatch(/SQLite/);
    expect(warnings).not.toContain("SECRET_");
  }
});
it("retries an unchanged database after a real SQLite read lock is released", async () => {
  const root = await sandbox(), directory = path.join(root, ".local/share/opencode");
  await fs.mkdir(directory, { recursive: true });
  const db = path.join(directory, "opencode.db");
  const data = JSON.stringify({ role: "assistant", modelID: "gpt-5", time: { created: 1795165200000, completed: 1795165201000 }, tokens: { input: 10, output: 5 } });
  execFileSync("sqlite3", [db, `CREATE TABLE message(id TEXT,session_id TEXT,time_created INTEGER,data TEXT); INSERT INTO message VALUES('healthy','s',1795165200000,'${data}');`]);
  const before = await fs.stat(db);
  const blocker = spawn("sqlite3", [db], { stdio: ["pipe", "pipe", "pipe"] });
  const ready = new Promise<void>((resolve, reject) => { blocker.once("error", reject); blocker.stdout.on("data", data => { if (String(data).includes("LOCKED")) resolve(); }); });
  blocker.stdin.write("BEGIN EXCLUSIVE;\nSELECT 'LOCKED';\n");
  await ready;
  const read = () => withSourceDiagnostics(() => withCollectionCache(root, () => cachedSource("collection-lock-fixture", [db],
    () => cachedSource("database-lock-fixture", [db], () => sqliteRows<{ id: string }>(db, "SELECT id FROM message;")))));
  const released = new Promise<void>(resolve => blocker.once("exit", () => resolve()));
  try {
    const partial = await read();
    blocker.stdin.end("ROLLBACK;\n");
    await released;
    expect(partial).toHaveLength(0);
    const after = await fs.stat(db);
    expect([after.size, after.mtimeMs, after.ctimeMs]).toEqual([before.size, before.mtimeMs, before.ctimeMs]);
    expect(await read()).toEqual([{ id: "healthy" }]);
    expect((await collectLocalUsage(root)).events.map(event => event.totalTokens)).toEqual([15]);
  } finally { if (blocker.exitCode === null) blocker.stdin.end("ROLLBACK;\n"); }
}, 20000);
it.skipIf(process.platform !== "linux")("keeps Grok projects with different invalid UTF-8 directory names distinct", async () => {
  const root = await sandbox();
  const row = { params: { sessionId: "same-session", _meta: { agentTimestampMs: 1795165200000 }, update: { sessionUpdate: "turn_completed", usage: { modelUsage: { "grok-4.5": { inputTokens: 10, outputTokens: 5 } } } } } };
  for (const byte of [0xfe, 0xff]) {
    const directory = Buffer.concat([Buffer.from(path.join(root, ".grok/sessions/project-")), Buffer.from([byte]), Buffer.from("/same-session")]);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(Buffer.concat([directory, Buffer.from("/updates.jsonl")]), jsonl(row));
  }
  const result = await collectGrok(root);
  expect(result.events.map(event => event.totalTokens)).toEqual([15, 15]);
  expect(new Set(result.events.map(event => event.sourcePath)).size).toBe(2);
  expect(JSON.stringify(toUsageSnapshotPayload(aggregateEvents(result.events)))).not.toContain("\uE000");
});
