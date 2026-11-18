import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { createClaudeJsonlParser, parseClaudeJsonl } from "../src/sources/claude.js";
import { collectCopilot } from "../src/sources/copilot.js";
import { parseDshJsonl } from "../src/sources/dsh.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";
import { withCollectionCache } from "../src/collection-cache.js";

const originalEnv = { ...process.env };
const roots: string[] = [];
afterEach(async () => {
  process.env = { ...originalEnv };
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function sandbox() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-nov19-"));
  roots.push(root);
  process.env = { PATH: originalEnv.PATH, TMPDIR: os.tmpdir() };
  return root;
}
async function write(root: string, relative: string, rows: object[]) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, rows.map(row => JSON.stringify(row)).join("\n") + "\n");
  return file;
}
const advisor = (iterations: unknown) => ({ timestamp: "2026-11-17T09:00:00Z", sessionId: "advisor-session", message: {
  id: "msg_advisor", model: "claude-sonnet-4-20250514", usage: {
    input_tokens: 4, output_tokens: 244, cache_creation_input_tokens: 12323, cache_read_input_tokens: 140030,
    cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 11142 }, iterations,
  },
} });
const iterations = [
  { type: "message", cache_creation: { ephemeral_1h_input_tokens: 11142 } },
  { type: "advisor_message", model: "claude-fable-5-2", cache_creation: { ephemeral_5m_input_tokens: 999, ephemeral_1h_input_tokens: 999 } },
  { type: "message", cache_creation: { ephemeral_5m_input_tokens: 1181 } },
];
it("sums every message iteration's TTL split without adding advisor usage", () => {
  const parser = createClaudeJsonlParser({ sourcePath: "/fixture/advisor.jsonl" });
  parser.pushLine(JSON.stringify(advisor(iterations)));
  const resumed = createClaudeJsonlParser({ sourcePath: "/fixture/advisor.jsonl" }, parser.snapshot());
  const events = resumed.finish();
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ cacheCreationTokens: 12323, cacheCreation5mTokens: 1181, cacheCreation1hTokens: 11142, totalTokens: 152601 });
  expect(aggregateEvents(events)[0].cost.totalUsd).toBe("0.116962");
});
it.each([null, "n/a", {}, [{ type: "message" }], [{ type: "message", cache_creation: { ephemeral_1h_input_tokens: -1 } }], [...iterations, { type: "message" }]])(
  "keeps top-level TTL information for incomplete or malformed iterations %j", value => {
    const event = parseClaudeJsonl(JSON.stringify(advisor(value)), { sourcePath: "/fixture/advisor.jsonl" })[0];
    expect(event).toMatchObject({ cacheCreationTokens: 12323, cacheCreation5mTokens: 0, cacheCreation1hTokens: 11142 });
  },
);
it.each(["reference", "replacement", "physical", "invalid-name"])("distinguishes %s Codex history from physically copied usage", async kind => {
  const root = await sandbox();
  const parent = "01a0bb8c-c7c0-7630-9d82-860b875930f0", child = "01a0cc9d-d8d1-8741-ae93-971c986041a1", replacement = "01a0ddae-e9e2-7852-bfa4-a82da97152b2";
  const usage = (timestamp: string) => ({ timestamp, type: "event_msg", payload: { type: "token_count", info: { model: "gpt-5", last_token_usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } } } });
  await write(root, ".codex/sessions/rollout-parent.jsonl", [
    { type: "session_meta", timestamp: "2026-09-19T12:00:00Z", payload: { id: parent } }, usage("2026-09-19T12:00:01Z"),
  ]);
  const filename = kind === "replacement" ? `rollout-2026-09-19T12-01-00-${child}_${replacement}.jsonl`
    : kind === "invalid-name" ? `rollout-backup-${child}_${replacement}.jsonl` : "rollout-child.jsonl";
  await write(root, `.codex/sessions/${filename}`, [
    { type: "session_meta", timestamp: "2026-09-19T12:01:00Z", payload: { id: child, forked_from_id: parent,
      ...(kind === "reference" ? { history_base: { thread_id: parent, end_ordinal_exclusive: 2 } } : {}) } }, usage("2026-09-19T12:02:00Z"),
  ]);
  for (let pass = 0; pass < 2; pass++) {
    const events = (await collectLocalUsage(root)).events.filter(event => event.agent === "codex");
    expect(events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(["reference", "replacement"].includes(kind) ? 300 : 150);
  }
});
it("discovers Claude XDG and expanded config roots while preserving the explicit home override", async () => {
  const root = await sandbox();
  const row = (id: string) => ({ timestamp: "2026-11-17T09:00:00Z", sessionId: id, message: { id: `msg_${id}`, model: "claude-sonnet-4", usage: { input_tokens: 10, output_tokens: 5 } } });
  await write(root, ".config/claude/projects/p/default.jsonl", [row("xdg")]);
  await write(root, ".claude/projects/p/default.jsonl", [row("legacy")]);
  await write(root, "custom/projects/p/custom.jsonl", [row("custom")]);
  expect((await collectLocalUsage(root)).events.filter(event => event.agent === "claude")).toHaveLength(2);
  process.env.CLAUDE_CONFIG_DIR = " ~/custom/projects, ~/custom ";
  const result = await collectLocalUsage(root);
  expect(result.events.filter(event => event.agent === "claude").map(event => event.sessionId)).toEqual(["custom"]);
  process.env.CLAUDE_HOME = path.join(root, ".claude");
  expect((await collectLocalUsage(root)).events.filter(event => event.agent === "claude").map(event => event.sessionId)).toEqual(["legacy"]);
});
it("counts Qwen live and flat archive sessions once and excludes unrelated nested JSONL", async () => {
  const root = await sandbox();
  const row = { type: "assistant", timestamp: "2026-02-24T02:00:00Z", model: "qwen3-coder-plus", sessionId: "session-a", usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } };
  for (const file of ["chats/session-a.jsonl", "chats/archive/session-a.jsonl", "chats/other/ignored.jsonl", "chats/archive/nested/deep.jsonl"])
    await write(root, `.qwen/projects/p/${file}`, [{ ...row, ...(!file.endsWith("session-a.jsonl") ? { sessionId: file } : {}) }]);
  const result = await collectLocalUsage(root);
  expect(result.sources.find(source => source.agent === "qwen")?.files).toBe(2);
  expect(result.events.filter(event => event.agent === "qwen").map(event => event.totalTokens)).toEqual([150]);
});
it("counts native Copilot receipts, preserves recorded credits and avoids watermark totals", async () => {
  const root = await sandbox();
  await fs.cp(new URL("./fixtures/ccusage-nov19/copilot/", import.meta.url), path.join(root, ".copilot"), { recursive: true });
  for (let pass = 0; pass < 2; pass++) {
    const events = (await withCollectionCache(root, () => collectCopilot(root))).events;
    const receipts = events.filter(event => event.sessionId === "session-receipts");
    expect(receipts.map(event => event.totalTokens)).toEqual([1280, 340, 560]);
    const recorded = events.filter(event => event.sessionId === "session-recorded-credits");
    expect(recorded).toHaveLength(2);
    expect(recorded.reduce((sum, event) => sum + Number(event.recordedCostUsd), 0)).toBeCloseTo(0.004024719);
    expect(aggregateEvents(recorded)[0].recordedCostUsd).toBe("0.004024719");
    const resumed = events.filter(event => event.sessionId === "session-resumed-receipts");
    expect(resumed.map(event => event.totalTokens)).toEqual([540, 280]);
    expect(resumed[0].recordedCostUsd).toBe("0.02");
    const payload = JSON.stringify(toUsageSnapshotPayload(aggregateEvents(events)));
    expect(payload).not.toMatch(/session-receipts|service-r|chatcmpl|sourcePath|accounting/);
    expect(payload).toContain("recorded_cost_usd");
  }
});
it("keeps dsh last-wins settlements and adds separately routed compaction usage", async () => {
  const raw = await fs.readFile(new URL("./fixtures/ccusage-nov19/dsh/parent/session.v4.jsonl", import.meta.url), "utf8");
  const events = parseDshJsonl(raw, "/fixture/session.v4.jsonl");
  expect(events.map(event => event.totalTokens)).toEqual([9500, 10120, 19800]);
  expect(events[2].model).toBe("deepseek-flash");
  const rows = raw.trim().split("\n").map(line => JSON.parse(line));
  rows[2].data = { provider: "openrouter", model: "anthropic/claude-sonnet-4.5" };
  expect(parseDshJsonl(rows.slice(0, 4).map(row => JSON.stringify(row)).join("\n"), "/fixture/session.v4.jsonl")[0].pricingModel).toBe("openrouter/anthropic/claude-sonnet-4.5");
  const fork = await fs.readFile(new URL("./fixtures/ccusage-nov19/dsh/fork/session.v4.jsonl", import.meta.url), "utf8");
  expect(parseDshJsonl(fork, "/fixture/session.v4.jsonl").map(event => event.totalTokens)).toEqual([5500, 5250]);
});

const receipt = (sequence: number, extra: object = {}) => ({ type: "session.usage_record", id: `record-${sequence}`, timestamp: `2026-11-17T09:00:0${sequence}Z`, data: { usage: {
  model: "gpt-5.4", inputTokens: 100, outputTokens: 10, cacheReadTokens: 20, cacheWriteTokens: 10,
  accounting: { sourceSessionId: "owner", sequence }, apiCallId: "shared-response", serviceRequestId: `service-${sequence}`, ...extra,
} } });
it("deduplicates Copilot receipts by accounting owner and replaces only their matching OTel calls", async () => {
  const root = await sandbox();
  await write(root, ".copilot/session-state/owner/events.jsonl", [receipt(1, { copilotUsage: { totalNanoAiu: 0 } })]);
  await write(root, ".copilot/session-state/copy/events.jsonl", [receipt(1, { copilotUsage: { totalNanoAiu: 0 } }),
    { type: "session.shutdown", timestamp: "2026-11-17T10:00:00Z", data: { usageAccountingWatermarks: { owner: 1 }, modelMetrics: { "gpt-5.4": { usage: { inputTokens: 1000, outputTokens: 100 } } } } },
  ]);
  const span = (sequence: number) => ({ type: "span", traceId: `trace-${sequence}`, spanId: `span-${sequence}`, name: "chat gpt-5.4", endTime: [Date.parse(`2026-11-17T09:00:0${sequence}Z`) / 1000, 0], attributes: {
    "gen_ai.conversation.id": "owner", "gen_ai.response.model": "gpt-5.4", "gen_ai.response.id": "shared-response", "github.copilot.service_request_id": `service-${sequence}`,
    "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": 10, "gen_ai.usage.cache_read.input_tokens": 20, "gen_ai.usage.cache_write.input_tokens": 10,
  } });
  await write(root, ".copilot/otel/calls.jsonl", [span(1), span(2)]);
  const events = (await collectCopilot(root)).events;
  expect(events).toHaveLength(2);
  expect(events.map(event => event.totalTokens)).toEqual([110, 110]);
  expect(events[0]).toMatchObject({ sessionId: "owner", recordedCostUsd: "0" });
  expect(events[1].recordedCostUsd).toBeUndefined();
  expect(aggregateEvents([events[0]])[0].cost.totalUsd).toBe("0.000000");
});
it("resumes Copilot receipt parsing after appends and retains mixed legacy intervals", async () => {
  const root = await sandbox();
  const first = { type: "session.shutdown", id: "legacy", timestamp: "2026-11-17T08:00:00Z", data: { modelMetrics: { "gpt-5.4": { usage: { inputTokens: 100, outputTokens: 10 }, totalNanoAiu: 1e9 } } } };
  const file = await write(root, ".copilot/session-state/owner/events.jsonl", [first]);
  expect((await withCollectionCache(root, () => collectCopilot(root))).events[0].recordedCostUsd).toBe("0.01");
  await fs.appendFile(file, JSON.stringify(receipt(1, { cost: 1000, copilotUsage: { totalNanoAiu: 2e9 } })) + "\n");
  const events = (await withCollectionCache(root, () => collectCopilot(root))).events;
  expect(events.map(event => event.totalTokens)).toEqual([110, 110]);
  expect(events.map(event => event.recordedCostUsd)).toEqual(["0.01", "0.02"]);
  expect(aggregateEvents(events).reduce((sum, bucket) => sum + Number(bucket.cost.totalUsd), 0)).toBeCloseTo(0.03);
});
it("prices Copilot shutdown deltas only when both interval endpoints report credits", async () => {
  const root = await sandbox();
  await write(root, ".copilot/session-state/owner/events.jsonl", [undefined, 25e9, 40e9].map((credits, index) => ({
    type: "session.shutdown", id: `shutdown-${index}`, timestamp: `2026-11-17T0${index}:00:00Z`, data: { modelMetrics: {
      "gpt-5.4": { usage: { inputTokens: [100, 300, 600][index] }, ...(credits === undefined ? {} : { totalNanoAiu: credits }) },
    } },
  })));
  expect((await collectCopilot(root)).events.map(event => [event.totalTokens, event.recordedCostUsd])).toEqual([[100, undefined], [200, undefined], [300, "0.15"]]);
});
it("preserves nano-AIU costs below one microdollar until the bucket is summed", async () => {
  const root = await sandbox();
  await write(root, ".copilot/session-state/owner/events.jsonl", [
    receipt(1, { copilotUsage: { totalNanoAiu: 1 } }),
    receipt(2, { copilotUsage: { totalNanoAiu: 99999 } }),
  ]);
  const events = (await collectCopilot(root)).events;
  expect(events.map(event => event.recordedCostUsd)).toEqual(["0.00000000001", "0.00000099999"]);
  const bucket = aggregateEvents(events)[0];
  expect(bucket.recordedCostUsd).toBe("0.00000100000");
  expect(bucket.cost.totalUsd).toBe("0.000001");
  expect(toUsageSnapshotPayload([bucket]).daily[0].slots[0].recorded_cost_usd).toBe("0.00000100000");
});
