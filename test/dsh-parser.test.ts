import { describe, expect, it } from "vitest";
import { parseDshJsonl, resolveDshSessionDirs } from "../src/sources/dsh.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";

// Schema-faithful records from dsh Session codecs and token-meter usage projection.
const time = Date.parse("2026-10-01T01:05:00Z");
const header = (version = 3, extra = {}) => ({ type: "session", version, id: "session-a", createdAt: time, isSeeded: false, delegationDepth: 0, ...extra });
const row = (type: string, seq: number, data: unknown) => ({ type, seq, time, data });
const request = row("request/header", 0, { header: { config: { provider: "deepseek-official", model: "deepseek-v4-flash" } } });
const usage = { inputTokens: 100, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 10, reasoningTokens: 5, totalTokens: 160 };
const settlement = (seq: number, turn = 1, step = 1, counts = usage) => row("assistant/message", seq, {
  turn, step, message: { role: "assistant", content: [{ type: "text", text: "PRIVATE_RESPONSE" }], source: { kind: "model", model: "deepseek-v4-flash" } }, usage: counts,
});
const parse = (...records: unknown[]) => parseDshJsonl(records.map((record) => JSON.stringify(record)).join("\n"), "/sessions/session.v3.jsonl");

describe("dsh Session accounting", () => {
  it("counts disjoint cache buckets and keeps reasoning inside output", () => {
    const events = parse(header(), request, row("user/message", 1, { text: "PRIVATE_PROMPT" }), settlement(2));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ agent: "dsh", model: "deepseek-v4-flash", sessionId: "session-a", inputTokens: 100, cachedInputTokens: 20, cacheCreationTokens: 10, outputTokens: 30, reasoningOutputTokens: 5, totalTokens: 160, bucketStart: "2026-10-01T01:00:00.000Z" });
    const uploaded = JSON.stringify(toUsageSnapshotPayload(aggregateEvents(events), {}));
    expect(uploaded).not.toMatch(/PRIVATE|sourcePath|eventSeq|session-a/);
    expect(uploaded).toContain('"agent":"dsh"');
  });

  it("takes the final stream sample and replaces repeated settlements in the same step", () => {
    const attempt = row("assistant/attempt", 1, { turn: 1, step: 1, stream: [
      { type: "chunk", time, chunk: { type: "usage", usage: { inputTokens: 2, outputTokens: 1 } } },
      { type: "chunk", time, chunk: { type: "usage", usage } },
    ] });
    const events = parse(header(), request, attempt, settlement(2));
    expect(events).toHaveLength(1);
    expect(events[0].totalTokens).toBe(160);
    expect(parse(header(), request, attempt)[0].totalTokens).toBe(160);
    expect(parse(header(), request, attempt, settlement(2, 1, 1, { ...usage, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 0 }))).toEqual([]);
  });

  it("adds separately billed retries and attributes a later call to its selected model", () => {
    const events = parse(header(), request, settlement(1), row("llm/retry-started", 2, { turn: 1, step: 1 }), settlement(3), row("request/header", 4, { header: { config: { model: "claude-sonnet-4" } } }), row("assistant/message", 5, { turn: 1, step: 2, message: { role: "assistant" }, usage: { inputTokens: 3, outputTokens: 2 } }));
    expect(events.map((event) => [event.model, event.totalTokens])).toEqual([["deepseek-v4-flash", 160], ["deepseek-v4-flash", 160], ["claude-sonnet-4", 5]]);
  });

  it("excludes the inherited prefix through the final tagged seed boundary", () => {
    const events = parse(header(3, { isSeeded: true, parentSession: "parent" }), request, settlement(1), row("session/end-seed", 2, { inherited: true }), settlement(3, 2));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ totalTokens: 160, eventSeq: 3 });
    expect(() => parse(header(3, { isSeeded: true }), request, settlement(1))).toThrow(/inherited-history boundary/);
  });

  it.each([0, 1, 2, 3, 4])("reads released/current format %i without counting chunk usage twice", (version) => {
    const records = [header(version, version < 2 ? { seedLength: 2 } : {}), request, settlement(1), row("assistant/chunk", 2, { turn: 2, step: 1, chunk: { type: "usage", usage } }), settlement(3, 2)];
    const file = `/session${version ? `.v${version}` : ""}.jsonl`;
    const events = parseDshJsonl(records.map((record) => JSON.stringify(record)).join("\n"), file);
    expect(events).toHaveLength(version < 2 ? 1 : 2);
  });

  it("refuses future formats and filename/header mismatches", () => {
    expect(() => parse(header(5))).toThrow(/Unsupported dsh Session format/);
    expect(() => parse(header(2))).toThrow(/version mismatch/);
    expect(() => parse(request, settlement(1))).toThrow(/header missing/);
  });

  it("resolves the official home and explicit session roots", () => {
    expect(resolveDshSessionDirs("/home/alice", {})).toEqual(["/home/alice/.dsh/sessions"]);
    expect(resolveDshSessionDirs("/home/alice", { DSH_HOME: "~/custom" })).toEqual(["/home/alice/custom/sessions"]);
    expect(resolveDshSessionDirs("/home/alice", { DSH_SESSIONS_DIR: " ~/store, /archive/store, ~/store " })).toEqual(["/home/alice/store", "/archive/store"]);
  });
});
