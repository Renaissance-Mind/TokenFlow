import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectGrok } from "../src/sources/grok.js";
import { collectZcode } from "../src/sources/zcode.js";
import { collectAntigravity, decodeProto } from "../src/sources/antigravity.js";
import {
  collectOpenClawDatabases,
  mergeOpenClawStores,
  parseOpenClawJsonl,
} from "../src/sources/openclaw.js";
import { parseKimiWireJsonl } from "../src/sources/kimi.js";
import { parseCodexJsonl } from "../src/sources/codex.js";
import { dedupeCodexSessions } from "../src/sources/codex-replay.js";
import { collectPiStores } from "../src/sources/pi.js";
import { collectLocalUsage } from "../src/file-scan.js";
import {
  parseGeminiSession,
  createGeminiJsonlParser,
} from "../src/sources/gemini.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";
import { normalizeAgentModelForUsage } from "../src/pricing.js";
import { optionalDecimalString } from "../src/sources/ccusage-common.js";
import { emptySyncState, markSyncPlanUploaded, planIncrementalSync } from "../src/sync-state.js";

// Schemas and wire fields from ccusage bb24af0 rust/adapters/{grok,zcode,antigravity,openclaw,kimi,codex,pi} tests.
const originalEnv = { ...process.env };
const temporary: string[] = [];
afterEach(async () => {
  process.env = { ...originalEnv };
  for (const root of temporary.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function root() {
  const result = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-harness-"));
  temporary.push(result);
  return result;
}
async function put(file: string, value: string) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, value);
}
function sqlite(file: string, sql: string) {
  execFileSync("sqlite3", [file, sql]);
}
const jsonl = (...rows: object[]) =>
  rows.map((row) => JSON.stringify(row)).join("\n");

describe("local harness compatibility", () => {
  it("deduplicates a Pi fork against its parent's active branch while retaining spent sibling requests", async () => {
    const home = await root(); const dir = path.join(home, "sessions");
    const header = { type: "session", id: "parent", timestamp: "2026-01-01T00:00:00Z" };
    const rootEntry = { type: "message", id: "root", parentId: null, message: { role: "user" } };
    const request = (id: string, parentId: string, input: number, timestamp: string) => ({ type: "message", id, parentId, timestamp, message: { role: "assistant", model: "gpt-5.5", usage: { input, output: 0 } } });
    const a = request("a", "root", 100, "2026-01-02T00:00:00Z");
    const b = request("b", "root", 200, "2026-01-02T00:01:00Z");
    const c = request("c", "a", 50, "2026-01-02T00:02:00Z");
    await put(path.join(dir, "parent.jsonl"), jsonl(header, rootEntry, a, b, c));
    await put(path.join(dir, "child.jsonl"), jsonl({ ...header, id: "child", parentSession: "parent.jsonl", timestamp: "2026-01-03T00:00:00Z" }, rootEntry, a, c,
      request("own", "c", 30, "2026-01-04T00:00:00Z")));
    const events = (await collectPiStores(home, [dir])).events;
    expect(events).toHaveLength(4);
    expect(events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(380);
  });
  it("keeps same-name models with distinct provider prices separate during aggregation and sync", () => {
    const base = { agent: "claude" as const, model: "claude-opus-4-8", sourcePath: "usage.jsonl", sessionId: "s",
      timestamp: "2026-06-09T00:00:00Z", bucketStart: "2026-06-09T00:00:00.000Z", inputTokens: 1000, cachedInputTokens: 0,
      outputTokens: 0, reasoningOutputTokens: 0, cacheCreationTokens: 0, totalTokens: 1000 };
    const buckets = aggregateEvents([{ ...base, pricingModel: "claude-opus-4-8" }, { ...base, pricingModel: "stealth/claude-opus-4.8" }]);
    expect(buckets).toHaveLength(2);
    expect(buckets.reduce((sum, bucket) => sum + Number(bucket.cost.totalUsd), 0)).toBeCloseTo(0.009);
    const plan = planIncrementalSync(buckets, emptySyncState());
    expect(plan.buckets).toHaveLength(2);
    const state = markSyncPlanUploaded(emptySyncState(), plan, "2026-06-09T01:00:00Z");
    expect(planIncrementalSync(buckets, state).buckets).toHaveLength(0);
    expect(toUsageSnapshotPayload(buckets).daily[0].slots).toHaveLength(2);
  });
  it("retains future provider model identity and safely normalizes tiny recorded USD values", () => {
    expect(normalizeAgentModelForUsage("opencode", "openai/future-coding-model")).toMatchObject({ model: "future-coding-model", pricingModel: "openai/future-coding-model" });
    expect(optionalDecimalString(1e-10)).toBe("0.0000000001");
    expect(optionalDecimalString(null)).toBeUndefined();
    expect(normalizeAgentModelForUsage("opencode", "azure/future-coding-model-20261001").pricingModel).toBe("azure/future-coding-model-20261001");
  });

  it("counts a Claude provider response copied across session logs only once", async () => {
    const home = await root();
    const message = { timestamp: "2026-06-09T00:00:00Z", type: "assistant", sessionId: "parent", message: { id: "provider-response-1", model: "claude-sonnet-4-6", usage: { input_tokens: 100, output_tokens: 20 } } };
    await put(path.join(home, ".claude/projects/project/parent.jsonl"), jsonl(message));
    await put(path.join(home, ".claude/projects/project/child.jsonl"), jsonl({ ...message, sessionId: "child" }));
    const events = (await collectLocalUsage(home)).events.filter((event) => event.agent === "claude");
    expect(events).toHaveLength(1); expect(events[0].totalTokens).toBe(120);
  });

  it("discovers existing ccusage named Pi stores and rejects overlapping roots", async () => {
    const home = await root(); const defaultRoot = path.join(home, "pi-sessions"); await fs.mkdir(defaultRoot);
    const named = path.join(home, "omp-sessions");
    await put(path.join(named, "session.jsonl"), jsonl({ type: "message", timestamp: "2026-06-09T00:00:00Z", message: { role: "assistant", model: "gpt-5.5", usage: { input: 10, output: 5 } } }));
    const config = path.join(home, ".config/claude/ccusage.json");
    await put(config, JSON.stringify({ pi: { stores: [{ name: "omp", path: named }] } }));
    expect((await collectPiStores(home, [defaultRoot])).events[0].agent).toBe("omp");
    await put(config, JSON.stringify({ pi: { stores: [{ name: "omp", path: defaultRoot }] } }));
    await expect(collectPiStores(home, [defaultRoot])).rejects.toThrow("Overlapping");
  });

  it("accepts a ZCode legacy ledger without optional fields and leaves incompatible schemas alone", async () => {
    const home = await root(); const dir = path.join(home, "zcode/cli/db"); await fs.mkdir(dir, { recursive: true });
    sqlite(path.join(dir, "db.sqlite"), `CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE model_usage(id TEXT,session_id TEXT,started_at INTEGER,model_id TEXT,status TEXT,input_tokens INTEGER,output_tokens INTEGER);
      INSERT INTO session VALUES('s','/project'); INSERT INTO model_usage VALUES('u','s',1786909042666,'custom-model','completed',10,5);`);
    process.env.ZCODE_HOME = path.join(home, "zcode");
    expect((await collectZcode(home)).events[0]).toMatchObject({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
  it("discovers nested Kimi Code agents, project Qwen logs and Gemini JSONL", async () => {
    const home = await root();
    await put(
      path.join(
        home,
        ".kimi-code/sessions/workspace/session/agents/agent/wire.jsonl",
      ),
      jsonl({
        type: "usage.record",
        model: "kimi-code/kimi-for-coding",
        usageScope: "turn",
        time: 1782113184943,
        usage: { inputOther: 100, output: 20 },
      }),
    );
    await put(
      path.join(home, ".qwen/projects/project/conversation.jsonl"),
      jsonl({
        type: "assistant",
        model: "qwen3-coder",
        timestamp: "2026-06-09T00:00:00Z",
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      }),
    );
    await put(
      path.join(home, ".gemini/tmp/project/chats/session.jsonl"),
      jsonl({
        type: "gemini",
        id: "gemini-1",
        model: "gemini-2.5-pro",
        timestamp: "2026-06-09T00:00:00Z",
        tokens: { input: 10, output: 5 },
      }),
    );
    const result = await collectLocalUsage(home);
    expect(result.events.map((event) => event.agent).sort()).toEqual([
      "gemini",
      "kimi",
      "qwen",
    ]);
    expect(
      result.events.find((event) => event.agent === "kimi")?.sessionId,
    ).toBe("session");
  });

  it("treats typed Gemini messages as requests and keeps the final JSONL record for an id", () => {
    const row = {
      type: "gemini",
      id: "one",
      model: "gemini-2.5-pro",
      timestamp: "2026-06-09T00:00:00Z",
      tokens: {
        input: 100,
        cached: 20,
        output: 10,
        thoughts: 5,
        tool: 2,
        total: 117,
      },
    };
    const parser = createGeminiJsonlParser({ sourcePath: "session.jsonl" });
    parser.pushLine(JSON.stringify(row));
    parser.pushLine(
      JSON.stringify({
        ...row,
        tokens: { ...row.tokens, output: 15, total: 122 },
      }),
    );
    expect(parser.finish()).toHaveLength(1);
    expect(parser.finish()[0]).toMatchObject({
      inputTokens: 102,
      cachedInputTokens: 20,
      outputTokens: 15,
      reasoningOutputTokens: 5,
      totalTokens: 122,
    });
    const records = parseGeminiSession(
      JSON.stringify({
        sessionId: "session",
        messages: [row, { ...row, id: "two" }],
      }),
      { sourcePath: "session.json" },
    );
    expect(records).toHaveLength(2);
    expect(records.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(
      234,
    );
  });

  it("reads OpenCode v2 sparse fork boundaries and uses aggregates only for uncovered sessions", async () => {
    const home = await root();
    const dir = path.join(home, ".local/share/opencode");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "opencode.db");
    sqlite(
      file,
      `CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,data TEXT);
      CREATE TABLE session_v2(id TEXT,time_created INTEGER,cost REAL,tokens_input INTEGER,tokens_output INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER,model TEXT,fork_session_id TEXT,fork_boundary TEXT);
      INSERT INTO session_v2 VALUES('parent',1782113184943,0,300,0,0,0,'gpt-5.5',NULL,NULL);
      INSERT INTO session_v2 VALUES('child',1782113184943,0,99,0,0,0,'gpt-5.5','parent','{"type":"before","messageID":"p2"}');
      INSERT INTO session_v2 VALUES('solo',1782113184943,0,7,3,0,0,'gpt-5.5',NULL,NULL);`,
    );
    for (const [id, session, seq, input] of [
      ["p1", "parent", 2, 100],
      ["p2", "parent", 10, 200],
      ["copy", "child", 2, 100],
      ["own", "child", 3, 50],
    ] as const) {
      const data = JSON.stringify({
        model: { id: "gpt-5.5", providerID: "openai" },
        tokens: { input, output: 0 },
      });
      sqlite(
        file,
        `INSERT INTO session_message VALUES('${id}','${session}','assistant',${seq},1782113184943,'${data}');`,
      );
    }
    const events = (await collectLocalUsage(home)).events.filter(
      (event) => event.agent === "opencode",
    );
    expect(events).toHaveLength(4);
    expect(events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(360);
  });

  it("uploads recorded cost subsets without losing token-priced calls in the same bucket", () => {
    const base = {
      agent: "grok" as const,
      model: "gpt-5.5",
      sourcePath: "updates.jsonl",
      sessionId: "s",
      timestamp: "2026-06-09T00:00:00Z",
      bucketStart: "2026-06-09T00:00:00.000Z",
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 100,
    };
    const buckets = aggregateEvents([
      { ...base, recordedCostUsd: "0.1" },
      base,
    ]);
    expect(buckets[0].cost.totalUsd).toBe("0.100500");
    const slot = toUsageSnapshotPayload(buckets).daily[0].slots[0];
    expect(slot).toMatchObject({
      recorded_cost_usd: "0.100000",
      recorded_usage: { input_tokens: 100, total_tokens: 100 },
    });
    expect(JSON.stringify(slot)).not.toContain("updates.jsonl");
  });
  it("reads completed Grok turns, carved cache input, recorded ticks and global event dedupe", async () => {
    const home = await root();
    process.env.GROK_HOME = path.join(home, "grok");
    const usage = {
      inputTokens: 100,
      outputTokens: 20,
      reasoningTokens: 10,
      cachedReadTokens: 30,
      cacheCreationTokens: 7,
      costUsdTicks: 100_000_000,
    };
    const row = {
      timestamp: 1786909042,
      params: {
        sessionId: "session-1",
        _meta: { eventId: "turn-1", agentTimestampMs: 1786909042666 },
        update: {
          sessionUpdate: "turn_completed",
          usage: { modelUsage: { "grok-4.5-build": usage } },
        },
      },
    };
    await put(
      path.join(process.env.GROK_HOME, "sessions/project/a/updates.jsonl"),
      jsonl(row, row, {
        ...row,
        params: {
          ...row.params,
          update: { sessionUpdate: "turn_started", usage },
        },
      }),
    );
    await put(
      path.join(process.env.GROK_HOME, "sessions/project/b/updates.jsonl"),
      jsonl(row),
    );
    const result = await collectGrok(home);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      inputTokens: 63,
      cachedInputTokens: 30,
      cacheCreationTokens: 7,
      outputTokens: 20,
      reasoningOutputTokens: 0,
      totalTokens: 120,
      recordedCostUsd: "0.01",
      pricingModel: "grok-4.5",
    });
  });

  it("reads only completed ZCode ledger rows, tolerates optional schema columns and deduplicates roots", async () => {
    const home = await root();
    const dir = path.join(home, "zcode", "cli", "db");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "db.sqlite");
    sqlite(
      file,
      `CREATE TABLE session(id TEXT,directory TEXT); CREATE TABLE model_usage(id TEXT,session_id TEXT,started_at INTEGER,model_id TEXT,status TEXT,input_tokens INTEGER,output_tokens INTEGER,cache_read_input_tokens INTEGER,cache_creation_input_tokens INTEGER,computed_total_tokens INTEGER);
      INSERT INTO session VALUES('s','/project'); INSERT INTO model_usage VALUES('u','s',1786909042666,'GLM-5.3','completed',100,10,25,15,120);
      INSERT INTO model_usage VALUES('pending','s',1786909042666,'GLM-5.3','pending',100,10,0,0,110);`,
    );
    process.env.ZCODE_HOME = `${path.join(home, "zcode")},${path.join(home, "zcode")}`;
    const result = await collectZcode(home);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      inputTokens: 60,
      cachedInputTokens: 25,
      cacheCreationTokens: 15,
      outputTokens: 10,
      totalTokens: 120,
      extraTotalTokens: 10,
      pricingModel: "zai/glm-5.3",
      timestamp: "2026-08-16T19:37:22.666Z",
    });
  });

  it("decodes Antigravity step/generator metadata, counts retries and merges copied identities", async () => {
    const home = await root();
    const dir = path.join(home, "antigravity", "conversations");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, "session.db");
    const usage = proto(
      [1, 246],
      [2, 100],
      [3, 30],
      [5, 50],
      [9, 10],
      [10, 20],
      [11, "response-1"],
    );
    const retry = proto([1, 246], [2, 40], [3, 10], [11, "response-retry"]);
    const time = proto([1, 1786909042], [2, 666000000]);
    const generation = proto([
      1,
      proto(
        [3, 246],
        [4, usage],
        [9, proto([4, time])],
        [17, proto([2, retry])],
      ),
    ]);
    const step = proto([8, time], [9, usage], [24, proto([1, 246])]);
    sqlite(
      file,
      `CREATE TABLE gen_metadata(idx INTEGER PRIMARY KEY,data BLOB); CREATE TABLE steps(idx INTEGER PRIMARY KEY,metadata BLOB);
      INSERT INTO gen_metadata VALUES(1,X'${generation.toString("hex")}'); INSERT INTO steps VALUES(1,X'${step.toString("hex")}');`,
    );
    await fs.copyFile(file, path.join(dir, "backup.db"));
    process.env.ANTIGRAVITY_DATA_DIR = path.join(home, "antigravity");
    const result = await collectAntigravity(home);
    expect(result.events).toHaveLength(2);
    expect(
      result.events.reduce((sum, event) => sum + event.totalTokens, 0),
    ).toBe(230);
    expect(
      result.events.find((event) => event.inputTokens === 100),
    ).toMatchObject({
      model: "gemini-2.5-pro",
      outputTokens: 20,
      reasoningOutputTokens: 10,
    });
    expect(() => decodeProto(Buffer.from([10, 5, 0]))).toThrow("Truncated");
  });

  it("lets OpenClaw SQLite win over migrated JSONL while keeping separate sessions", async () => {
    const home = await root();
    const file = path.join(home, "agents/main/agent/openclaw-agent.sqlite");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const message = {
      id: "evt-1",
      type: "message",
      timestamp: "2026-01-30T06:18:55.279Z",
      message: {
        role: "assistant",
        model: "gpt-5.2",
        usage: {
          input: 1660,
          output: 55,
          cacheRead: 108928,
          cost: { total: 0.02 },
        },
      },
    };
    sqlite(
      file,
      "CREATE TABLE transcript_events(session_id TEXT,seq INTEGER,event_json TEXT,created_at INTEGER);",
    );
    sqlite(
      file,
      `INSERT INTO transcript_events VALUES('abc',1,'${JSON.stringify(message)}',1769753935279); INSERT INTO transcript_events VALUES('abc',2,'not json',1769753935279);`,
    );
    const legacy = parseOpenClawJsonl(
      jsonl({
        ...message,
        message: {
          ...message.message,
          usage: { ...message.message.usage, cost: { total: 0.01 } },
        },
      }),
      { sourcePath: "abc.jsonl" },
    );
    const stored = await collectOpenClawDatabases([home]);
    expect(mergeOpenClawStores(legacy, stored.events)).toHaveLength(1);
    expect(mergeOpenClawStores(legacy, stored.events)[0].recordedCostUsd).toBe(
      "0.02",
    );
  });

  it("accepts Kimi Code turn records and ignores cumulative session records", () => {
    const usage = {
      inputOther: 3064,
      output: 76,
      inputCacheRead: 14848,
      inputCacheCreation: 0,
    };
    const events = parseKimiWireJsonl(
      jsonl(
        {
          type: "usage.record",
          model: "kimi-code/kimi-for-coding",
          usage,
          usageScope: "turn",
          time: 1782113184943,
        },
        {
          type: "usage.record",
          model: "kimi-code/kimi-for-coding",
          usage,
          usageScope: "session",
          time: 1782113185000,
        },
      ),
      { sourcePath: "sessions/workspace/session-b/agents/agent-1/wire.jsonl" },
    );
    expect(events).toHaveLength(1);
    expect(events[0].totalTokens).toBe(17988);
  });

  it("counts remote Codex compaction once and suppresses one covered by an advancing token_count", () => {
    const context = { type: "turn_context", payload: { model: "gpt-5.5" } };
    const record = {
      timestamp: "2026-09-01T00:00:02Z",
      type: "token_usage_record",
      payload: {
        response_id: "compact-1",
        usage: {
          input_tokens: 300,
          cached_input_tokens: 200,
          output_tokens: 30,
        },
      },
    };
    const marker = {
      type: "compacted",
      payload: { compaction_response_id: "compact-1" },
    };
    expect(
      parseCodexJsonl(jsonl(context, record, marker, record), {
        sourcePath: "rollout.jsonl",
      }),
    ).toHaveLength(1);
    const count = {
      timestamp: "2026-09-01T00:00:03Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: record.payload.usage,
          total_token_usage: record.payload.usage,
        },
      },
    };
    expect(
      parseCodexJsonl(jsonl(context, record, count, marker), {
        sourcePath: "rollout.jsonl",
      }),
    ).toHaveLength(1);
    const remote = parseCodexJsonl(jsonl(context, record, marker), {
      sourcePath: "parent.jsonl",
    });
    const child = remote.map((event) => ({ ...event, sessionId: "child" }));
    expect(
      dedupeCodexSessions([
        {
          id: "parent",
          events: remote,
          compactions: new Map([["compact-1", record.timestamp]]),
        },
        {
          id: "child",
          parent: "parent",
          forkTime: "2026-09-02T00:00:00Z",
          events: child,
          compactions: new Map(),
        },
      ]),
    ).toHaveLength(1);
  });

  it("excludes Pi derived artifact transcripts and copied parent prefix", async () => {
    const home = await root();
    const dir = path.join(home, "sessions");
    const message = {
      type: "message",
      id: "entry-1",
      timestamp: "2026-01-02T00:00:00Z",
      message: {
        role: "assistant",
        model: "gpt-5.2",
        usage: { input: 100, output: 20 },
      },
    };
    await put(
      path.join(dir, "parent.jsonl"),
      jsonl(
        { type: "session", id: "parent", timestamp: "2026-01-01T00:00:00Z" },
        message,
      ),
    );
    await put(
      path.join(dir, "child.jsonl"),
      jsonl(
        {
          type: "session",
          id: "child",
          parentSession: "parent.jsonl",
          timestamp: "2026-01-03T00:00:00Z",
        },
        message,
        { ...message, id: "entry-2", timestamp: "2026-01-04T00:00:00Z" },
      ),
    );
    await put(path.join(dir, "subagent-artifacts/copy.jsonl"), jsonl(message));
    expect((await collectPiStores(home, [dir])).events).toHaveLength(2);
  });
});

function proto(...fields: Array<[number, number | string | Buffer]>): Buffer {
  const varint = (value: number): Buffer => {
    const result: number[] = [];
    let n = BigInt(value);
    do {
      result.push(Number(n & 127n) | (n > 127n ? 128 : 0));
      n >>= 7n;
    } while (n);
    return Buffer.from(result);
  };
  return Buffer.concat(
    fields.map(([key, value]) => {
      if (typeof value === "number")
        return Buffer.concat([varint(key * 8), varint(value)]);
      const data = typeof value === "string" ? Buffer.from(value) : value;
      return Buffer.concat([varint(key * 8 + 2), varint(data.length), data]);
    }),
  );
}
