import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectCopilot } from "../src/sources/copilot.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";
const roots: string[] = [];
const env = { ...process.env };
afterEach(async () => { process.env = { ...env }; for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true }); });
async function home() { const r = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-copilot-")); roots.push(r); process.env.COPILOT_HOME = path.join(r, ".copilot"); delete process.env.COPILOT_OTEL_FILE_EXPORTER_PATH; return r; }
async function write(r: string, rows: object[]) { const file = path.join(r, ".copilot/session-state/s/events.jsonl"); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, rows.map(v => JSON.stringify(v)).join("\n")); }
const checkpoint = (id: string, timestamp: string, credits: number) => ({ type: "session.usage_checkpoint", id, timestamp, data: { totalNanoAiu: credits * 1e9 } });
const shutdown = (id: string, timestamp: string, credits: number, modelCredits: number) => ({ type: "session.shutdown", id, timestamp, data: { totalNanoAiu: credits * 1e9, modelMetrics: { "test-model": { usage: { inputTokens: 100, outputTokens: 50 }, totalNanoAiu: modelCredits * 1e9 } } } });

describe("Copilot native local sources", () => {
  it("uses existing OTel calls missed by shutdowns, subtracts caches and deduplicates response exports", async () => {
    const r = await home();
    const timestamp = "2026-01-02T10:00:00Z";
    await write(r, [{ type: "session.shutdown", id: "s", timestamp, data: { modelMetrics: { "gpt-5.4": { usage: { inputTokens: 100, outputTokens: 50 }, requests: { count: 1 } } } } }]);
    const span = (id: string, output: number) => ({ type: "span", traceId: id, spanId: id, name: "chat gpt-5.4", endTime: [1767344400, 0], attributes: { "gen_ai.response.model": "gpt-5.4", "gen_ai.conversation.id": "s", "gen_ai.response.id": "response", "gen_ai.usage.input_tokens": 100, "gen_ai.usage.output_tokens": output, "gen_ai.usage.cache_read.input_tokens": 10, "gen_ai.usage.cache_write.input_tokens": 20 } });
    const file = path.join(r, ".copilot/otel/trace.jsonl"); await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, [span("one", 50), span("copy", 50), span("two", 60)].map(v => JSON.stringify(v)).join("\n"));
    const events = (await collectCopilot(r)).events;
    expect(events).toHaveLength(2);
    expect(events.reduce((s, e) => s + e.inputTokens, 0)).toBe(140);
    expect(events.reduce((s, e) => s + e.outputTokens, 0)).toBe(110);
    expect(events.reduce((s, e) => s + e.totalTokens, 0)).toBe(310);
  });
  it("reads upstream fixtures, reconciles resumed snapshots and existing OTel without duplicate billing", async () => {
    const r = await home();
    await fs.cp(new URL("./fixtures/copilot/", import.meta.url), path.join(r, ".copilot"), { recursive: true });
    const result = await collectCopilot(r);
    expect(result.source.files).toBe(4);
    const a = result.events.filter(e => e.sessionId === "session-a");
    expect(a.reduce((s, e) => s + e.inputTokens, 0)).toBe(163);
    expect(a.reduce((s, e) => s + e.outputTokens, 0)).toBe(94);
    const credits = result.events.filter(e => e.recordedCostUsd !== undefined);
    expect(credits.filter(e => e.model === "unknown").reduce((s, e) => s + Number(e.recordedCostUsd), 0)).toBeCloseTo(0.08);
    expect(credits.reduce((s, e) => s + Number(e.recordedCostUsd), 0)).toBeCloseTo(0.11);
    const payload = JSON.stringify(toUsageSnapshotPayload(aggregateEvents(result.events)));
    expect(payload).not.toContain("private prompt");
    expect(payload).not.toContain("session-a");
    expect(payload).toContain("recorded_cost_usd");
  });
  it("reconciles split OTel exports and attributes them to the trace model", async () => {
    const r = await home();
    const otel = path.join(r, ".copilot/otel");
    await fs.mkdir(otel, { recursive: true });
    const attributes = {
      "gen_ai.conversation.id": "s",
      "gen_ai.response.id": "response-1",
      "gen_ai.usage.input_tokens": 1,
    };
    const span = { type: "span", traceId: "trace-1", spanId: "span-1", name: "chat", attributes: { ...attributes, "gen_ai.operation.name": "chat" } };
    await fs.writeFile(path.join(otel, "a.jsonl"), JSON.stringify({ ...span, endTime: "2026-01-02T09:00:00Z" }));
    await fs.writeFile(path.join(otel, "b.jsonl"), JSON.stringify({ ...span, endTime: "2026-01-02T09:05:00Z", attributes: { ...span.attributes, "gen_ai.response.model": "gpt-5.4" } }));
    const { events } = await collectCopilot(r);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ model: "gpt-5.4", sessionId: "s", timestamp: "2026-01-02T09:00:00.000Z", inputTokens: 1 });
  });
  it("only reports unexplained credits that remain unexplained in all future shutdowns", async () => {
    const r = await home();
    await write(r, [checkpoint("c", "2026-01-02T09:00:00Z", 51), shutdown("s1", "2026-01-02T10:00:00Z", 93, 42), shutdown("s2", "2026-01-03T10:00:00Z", 93, 93)]);
    const events = (await collectCopilot(r)).events;
    expect(events.filter(e => e.model === "unknown")).toHaveLength(0);
    expect(events.reduce((sum, e) => sum + Number(e.recordedCostUsd || 0), 0)).toBeCloseTo(0.93);
  });
  it("keeps checkpoint-only credits and avoids credit guesses for legacy shutdowns", async () => {
    const r = await home(); await write(r, [checkpoint("c", "2026-01-02T09:00:00Z", 7)]);
    expect((await collectCopilot(r)).events[0]).toMatchObject({ model: "unknown", totalTokens: 0, recordedCostUsd: "0.07" });
    await write(r, [shutdown("s", "2026-01-02T10:00:00Z", 93, 42)]);
    const events = (await collectCopilot(r)).events;
    expect(events.filter(e => e.model === "unknown")).toHaveLength(0);
    expect(events[0].recordedCostUsd).toBe("0.42");
  });
});
