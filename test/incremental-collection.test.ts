import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { ScanTracker, withScanTracker } from "../src/scan-progress.js";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { publishLocalCache, readLocalCache } from "../src/local-cache.js";
import { desktopAction } from "../src/desktop-service.js";
import { runBackgroundCollector } from "../src/background.js";
import { createRequire } from "node:module";

const original = { ...process.env };
const roots: string[] = [];
afterEach(async () => {
  process.env = { ...original };
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-incremental-"));
  roots.push(root);
  for (const key of Object.keys(process.env)) if (/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_SESSIONS_DIR|DSH_HOME|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENUSAGE_HOME)$/.test(key)) delete process.env[key];
  process.env.TOKENFLOW_HOME = path.join(root, "data");
  process.env.TOKENFLOW_SCAN_HOME = root;
  return root;
}
async function put(root: string, name: string, contents: string | Buffer) {
  const file = path.join(root, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents);
  return file;
}
const header = () => [{ type: "session_meta", payload: { id: "session" } }, { type: "turn_context", payload: { model: "gpt-5" } }];
const row = (total: number) => ({ type: "event_msg", timestamp: "2026-10-16T10:00:00Z", payload: { type: "token_count", info: { total_token_usage: { input_tokens: total, output_tokens: 0, total_tokens: total } } } });
const jsonl = (rows: unknown[]) => rows.map(value => JSON.stringify(value)).join("\n") + "\n";
async function scan(root: string) {
  let bytes = 0;
  const result = await collectLocalUsage(root, progress => { bytes = progress.readBytes; });
  return { ...result, bytes, tokens: result.events.reduce((sum, event) => sum + event.totalTokens, 0) };
}

it("reuses historical files and resumes cumulative counts at the appended bytes", async () => {
  const root = await setup();
  const privateText = "PRIVATE_PROMPT_DO_NOT_CACHE".repeat(4000);
  const file = await put(root, ".codex/sessions/a.jsonl", jsonl([...header(), { type: "message", text: privateText }, row(100)]));
  const initial = await scan(root);
  expect(initial.tokens).toBe(100);
  expect(initial.bytes).toBe((await fs.stat(file)).size);
  const warm = await scan(root);
  expect(warm.tokens).toBe(100); expect(warm.bytes).toBe(0);
  expect(warm.revision).toBe(initial.revision);
  const tail = jsonl([row(130)]);
  await fs.appendFile(file, tail);
  const next = await scan(root);
  expect(next.tokens).toBe(130); expect(next.events).toHaveLength(2);
  expect(next.bytes).toBe(Buffer.byteLength(tail));
  const cacheRoot = path.join(root, "data/collection-cache");
  for (const directory of await fs.readdir(cacheRoot, { withFileTypes: true })) if (directory.isDirectory()) {
    for (const entry of await fs.readdir(path.join(cacheRoot, directory.name))) {
      const bytes = await fs.readFile(path.join(cacheRoot, directory.name, entry));
      expect(bytes.includes(Buffer.from("PRIVATE_PROMPT_DO_NOT_CACHE"))).toBe(false);
    }
  }
});

it("retains a torn EOF record until completed and replaces truncated or rotated files", async () => {
  const root = await setup();
  const file = await put(root, ".codex/sessions/a.jsonl", jsonl([...header(), row(100)]));
  await scan(root);
  const line = JSON.stringify(row(150));
  await fs.appendFile(file, line.slice(0, 45));
  expect((await scan(root)).tokens).toBe(100);
  await fs.appendFile(file, line.slice(45) + "\n");
  expect((await scan(root)).tokens).toBe(150);
  await fs.writeFile(file, jsonl([...header(), row(7)]));
  expect((await scan(root)).tokens).toBe(7);
  const replacement = await put(root, "replacement.jsonl", jsonl([...header(), row(9)]));
  await fs.rename(replacement, file);
  expect((await scan(root)).tokens).toBe(9);
  await fs.unlink(file);
  expect((await scan(root)).tokens).toBe(0);
});

it("preserves Claude response deduplication across appended and copied histories", async () => {
  const root = await setup();
  const message = (id: string, input: number) => ({ timestamp: "2026-10-16T10:00:00Z", requestId: id, message: { id, model: "claude-sonnet-4-6", usage: { input_tokens: input, output_tokens: 2 } } });
  const file = await put(root, ".claude/projects/a/history.jsonl", jsonl([message("msg_1", 10)]));
  await scan(root);
  await fs.appendFile(file, jsonl([message("msg_1", 10), message("msg_2", 20)]));
  await put(root, ".claude/projects/b/copy.jsonl", jsonl([message("msg_1", 10)]));
  expect((await scan(root)).tokens).toBe(34);
  expect((await scan(root)).bytes).toBe(0);
});

it("invalidates pricing context and reuses compressed archives without decompression", async () => {
  const root = await setup();
  await put(root, ".codex/sessions/a.jsonl", jsonl([...header(), row(100)]));
  await scan(root);
  await put(root, ".codex/config.toml", 'service_tier = "priority"\n');
  expect((await scan(root)).events[0].serviceTier).toBe("fast");
  await put(root, ".codex/archived_sessions/archive.jsonl.zst", await fs.readFile(new URL("./fixtures/codex-compressed/rollout.jsonl.zst", import.meta.url)));
  expect((await scan(root)).tokens).toBe(220);
  expect((await scan(root)).bytes).toBe(0);
});

it.skipIf(Number(process.versions.node.split(".")[0]) < 22)("notices SQLite WAL commits even when the main database file has not changed", async () => {
  const root = await setup();
  const file = await put(root, ".local/share/opencode/opencode.db", "");
  process.env.OPENCODE_DB = file;
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, time_updated INTEGER); CREATE TABLE project (id TEXT PRIMARY KEY, worktree TEXT); CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);");
    const insert = db.prepare("INSERT INTO message VALUES (?, 'session', 1780974000000, 1780974010000, ?)");
    const data = (input: number) => JSON.stringify({role:"assistant", modelID:"gpt-5",time:{created:1780974000000,completed:1780974010000},tokens:{input,output:2}});
    insert.run("one", data(10));
    expect((await scan(root)).tokens).toBe(12);
    const main = await fs.stat(file);
    insert.run("two", data(20));
    expect((await fs.stat(file)).mtimeMs).toBe(main.mtimeMs);
    expect((await scan(root)).tokens).toBe(34);
    expect((await scan(root)).bytes).toBe(0);
  } finally { db.close(); }
});

it("rebuilds a corrupted source cache and publishes stable snapshots consumed without rescanning", async () => {
  const root = await setup();
  await put(root, ".codex/sessions/a.jsonl", jsonl([...header(), row(100)]));
  const first = await scan(root);
  await publishLocalCache(first, null);
  const snapshot = path.join(root, "data/local-cache.json");
  const before = (await fs.stat(snapshot)).mtimeMs;
  await publishLocalCache(await scan(root), null);
  expect((await fs.stat(snapshot)).mtimeMs).toBe(before);
  // A cache read must work even after the original source is no longer accessible.
  await fs.rename(path.join(root, ".codex"), path.join(root, "removed-codex"));
  expect((await desktopAction("state") as any).summary).toEqual((await readLocalCache())!.summary);
  expect((await desktopAction("dashboard", {path:"/api/usage/summary?from=2026-10-16&to=2026-10-16"}) as any).totals.total_tokens).toBe("100");
  await fs.rename(path.join(root, "removed-codex"), path.join(root, ".codex"));
  const directory = (await fs.readdir(path.join(root, "data/collection-cache"), {withFileTypes:true})).find(entry=>entry.isDirectory())!;
  const cache = path.join(root, "data/collection-cache", directory.name);
  for (const name of await fs.readdir(cache)) await fs.writeFile(path.join(cache, name), "broken");
  const rebuilt = await scan(root);
  expect(rebuilt.tokens).toBe(100); expect(rebuilt.bytes).toBeGreaterThan(0);
});

it("collects appended usage in the background without a Dashboard or repeated snapshot writes", async () => {
  const root = await setup();
  const file = await put(root, ".codex/sessions/a.jsonl", jsonl([...header(), row(100)]));
  const controller = new AbortController();
  const task = runBackgroundCollector({ signal:controller.signal, interval:30 });
  try {
    await vi.waitFor(async () => expect((await readLocalCache())?.dashboard.buckets.reduce((n,b)=>n+b.totalTokens,0)).toBe(100));
    const snapshot = path.join(root,"data/local-cache.json");
    const before = (await fs.stat(snapshot)).mtimeMs;
    await new Promise(resolve=>setTimeout(resolve,100));
    expect((await fs.stat(snapshot)).mtimeMs).toBe(before);
    await fs.appendFile(file, jsonl([row(140)]));
    await vi.waitFor(async () => expect((await readLocalCache())?.dashboard.buckets.reduce((n,b)=>n+b.totalTokens,0)).toBe(140));
    await desktopAction("configure",{paused:true});
    expect((await fs.readdir(path.join(root,"data"))).filter(name=>name.startsWith("background-yield-"))).toEqual([]);
    await new Promise(resolve=>setTimeout(resolve,80));
    await fs.appendFile(file,jsonl([row(150)]));
    await new Promise(resolve=>setTimeout(resolve,100));
    expect((await readLocalCache())!.dashboard.buckets.reduce((n,b)=>n+b.totalTokens,0)).toBe(140);
    await desktopAction("configure",{paused:false});
    await vi.waitFor(async()=>expect((await readLocalCache())!.dashboard.buckets.reduce((n,b)=>n+b.totalTokens,0)).toBe(150));
  } finally { controller.abort(); await task; }
});

const stamp = (n: number) => new Date(Date.parse("2026-10-16T10:00:00Z") + n * 1000).toISOString();
const transcriptCases: Array<{ name: string; file: string; prefix?: unknown[]; next: (n: number) => unknown }> = [
  { name:"Gemini", file:".gemini/tmp/project/session.jsonl", next:n=>({type:"gemini",id:String(n),sessionId:"a",model:"gemini-2.5-pro",timestamp:stamp(n),tokens:{input:10,output:2,total:12}}) },
  { name:"Kimi", file:".kimi/sessions/project/a/wire.jsonl", next:n=>({type:"usage.record",usageScope:"turn",time:Date.parse(stamp(n)),model:"kimi-code/kimi-k2.6",usage:{inputOther:10,output:2,total:12}}) },
  { name:"Qwen", file:".qwen/projects/a/chats/a.jsonl", next:n=>({type:"assistant",sessionId:"a",model:"qwen3-coder-plus",timestamp:stamp(n),usageMetadata:{promptTokenCount:10,candidatesTokenCount:2,totalTokenCount:12}}) },
  { name:"OpenClaw", file:".openclaw/agents/main/sessions/a.jsonl", next:n=>({type:"message",id:String(n),timestamp:stamp(n),message:{role:"assistant",model:"gpt-5",usage:{input:10,output:2,totalTokens:12}}}) },
  { name:"Pi", file:".pi/agent/sessions/a.jsonl", prefix:[{type:"session",id:"a",timestamp:stamp(0)}],next:n=>({type:"message",id:String(n),parentId:n>1?String(n-1):undefined,timestamp:stamp(n),message:{role:"assistant",model:"gpt-5",usage:{input:10,output:2,totalTokens:12}}}) },
  { name:"dsh", file:".dsh/sessions/a/session.jsonl",prefix:[{type:"session",version:0,id:"a"}],next:n=>({type:"assistant/message",seq:n,time:Date.parse(stamp(n)),data:{turn:n,step:1,message:{source:{model:"gpt-5"}},usage:{inputTokens:10,outputTokens:2,totalTokens:12}}}) },
  { name:"Grok", file:".grok/sessions/a/updates.jsonl",next:n=>({timestamp:Date.parse(stamp(n))/1000,params:{sessionId:"a",_meta:{eventId:String(n),agentTimestampMs:Date.parse(stamp(n))},update:{sessionUpdate:"turn_completed",usage:{modelUsage:{"grok-4":{inputTokens:10,outputTokens:2}}}}}}) },
  { name:"Copilot native", file:".copilot/session-state/a/events.jsonl",next:n=>({type:"session.shutdown",id:String(n),timestamp:stamp(n),data:{modelMetrics:{"gpt-5":{usage:{inputTokens:n*10,outputTokens:n*2},requests:{count:n},totalNanoAiu:n}},totalNanoAiu:n}}) },
  { name:"Copilot telemetry", file:".copilot/otel/a.jsonl",next:n=>({type:"span",traceId:"trace"+n,spanId:"span"+n,name:"chat gpt-5",startTime:Date.parse(stamp(n)),endTime:Date.parse(stamp(n))+10,attributes:{"gen_ai.operation.name":"chat","gen_ai.response.model":"gpt-5","gen_ai.conversation.id":"a","gen_ai.usage.input_tokens":10,"gen_ai.usage.output_tokens":2,"gen_ai.usage.total_tokens":12,"gen_ai.prompt":"PRIVATE_PROMPT_DO_NOT_CACHE"}}) },
];
it.each(transcriptCases)("resumes $name from its saved transcript checkpoint", async ({file:name,prefix=[],next}) => {
  const root = await setup();
  const file = await put(root,name,jsonl([...prefix,next(1)]));
  expect((await scan(root)).tokens).toBe(12);
  expect((await scan(root)).bytes).toBe(0);
  const tail=jsonl([next(2)]);
  await fs.appendFile(file,tail);
  const appended=await scan(root);
  expect(appended.tokens).toBe(24);
  expect(appended.bytes).toBe(Buffer.byteLength(tail));
  expect((await scan(root)).bytes).toBe(0);
});

it("continues an initially empty log and skips an oversized tail across appends", async () => {
  const root = await setup();
  const file = await put(root,".codex/sessions/a.jsonl","");
  expect((await scan(root)).tokens).toBe(0);
  await fs.appendFile(file,jsonl([...header(),row(100)])+'x'.repeat(17*1024*1024));
  expect((await scan(root)).tokens).toBe(100);
  expect((await scan(root)).bytes).toBe(0);
  const tail='\n'+jsonl([row(140)]);
  await fs.appendFile(file,tail);
  const result=await scan(root);
  expect(result.tokens).toBe(140);
  expect(result.bytes).toBe(Buffer.byteLength(tail));
});

it("commits the captured prefix while a live log grows during the read", async () => {
  const root=await setup();
  const file=await put(root,".codex/sessions/live.jsonl",jsonl([...header(),{type:"message",text:"private".repeat(50_000)},row(100)]));
  const tail=jsonl([row(150)]);
  let appended=false;
  const tracker=new ScanTracker(progress=>{
    if(!appended&&progress.readBytes>0){appended=true;appendFileSync(file,tail);}
  },0);
  await tracker.begin([file]);
  const first=await withScanTracker(tracker,()=>collectLocalUsage(root));
  expect(appended).toBe(true);
  expect(first.events.reduce((n,event)=>n+event.totalTokens,0)).toBe(100);
  const resumed=await scan(root);
  expect(resumed.tokens).toBe(150);
  expect(resumed.bytes).toBe(Buffer.byteLength(tail));
  expect((await scan(root)).bytes).toBe(0);
});
