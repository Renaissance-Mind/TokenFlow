import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { codexRolloutLines } from "../src/sources/codex-reader.js";
import { ScanTracker } from "../src/scan-progress.js";
const roots: string[] = [];
const env = { ...process.env };
afterEach(async () => { process.env = { ...env }; for (const r of roots.splice(0)) await fs.rm(r, { recursive: true, force: true }); });
async function home() { const r = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-zst-")); roots.push(r); process.env.CODEX_HOME = path.join(r, ".codex"); return r; }
const fixture = (name: string) => new URL(`./fixtures/codex-compressed/${name}`, import.meta.url);
async function put(home: string, file: string, data: string | Buffer) { const p = path.join(home, ".codex", file); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, data); return p; }
async function events(home: string) { return (await collectLocalUsage(home)).events.filter(e => e.agent === "codex"); }

// Wire fields and accounting expectations follow ccusage 4d900db compression_tests.rs.
describe("Codex compressed rollouts", () => {
  it("collects a complete history larger than the JavaScript argument limit", async () => {
    const r = await home();
    const count = 600_000;
    const lines = [
      JSON.stringify({ type: "session_meta", payload: { id: "large-history" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-5" } }),
    ];
    for (let i = 1; i <= count; i++) {
      lines.push(JSON.stringify({
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: {
          input_tokens: i, cached_input_tokens: 0, output_tokens: 0, total_tokens: i,
        } } },
      }));
    }
    await put(r, "sessions/rollout-large.jsonl", lines.join("\n"));
    const collected = await events(r);
    expect(collected).toHaveLength(count);
    expect(collected.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(count);
  }, 20_000);
  it("keeps fork replay and remote compaction accounting when every log is compressed", async () => {
    const r = await home();
    for (const name of ["parent", "child"]) await put(r, `sessions/${name}.jsonl.zst`, await fs.readFile(fixture(`${name}.jsonl.zst`)));
    expect((await events(r)).reduce((n, e) => n + e.totalTokens, 0)).toBe(190);
    await put(r, "archived_sessions/compaction.jsonl.zst", await fs.readFile(fixture("compaction.jsonl.zst")));
    expect((await events(r)).reduce((n, e) => n + e.totalTokens, 0)).toBe(830);
  });
  it("keeps compressed accounting identical to plain rollouts and deduplicates encodings/archives", async () => {
    const r = await home(), plain = await fs.readFile(fixture("rollout.jsonl")), compressed = await fs.readFile(fixture("rollout.jsonl.zst"));
    await put(r, "sessions/2026/10/14/rollout.jsonl.zst", compressed);
    const first = await events(r);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ sessionId: "compressed-parent", inputTokens: 100, cachedInputTokens: 80, outputTokens: 20, totalTokens: 120 });
    await put(r, "sessions/2026/10/14/rollout.jsonl", plain);
    await put(r, "archived_sessions/2026/10/14/rollout.jsonl.zst", compressed);
    const second = await events(r);
    expect(second).toHaveLength(1);
    expect(second[0].totalTokens).toBe(120);
  });
  it("preserves cumulative deltas across frames and completed records before a torn frame", async () => {
    const r = await home(), first = await fs.readFile(fixture("rollout.jsonl.zst")), next = await fs.readFile(fixture("next.jsonl.zst"));
    const file = await put(r, "archived_sessions/rollout.jsonl.zst", Buffer.concat([first, next]));
    expect((await events(r)).reduce((n, e) => n + e.totalTokens, 0)).toBe(240);
    await fs.writeFile(file, Buffer.concat([first, next.subarray(0, 10)]));
    expect((await events(r)).reduce((n, e) => n + e.totalTokens, 0)).toBe(120);
  });
  it("opens the other encoding after a migration and surfaces corrupt frames", async () => {
    const r = await home(), compressed = await fs.readFile(fixture("rollout.jsonl.zst"));
    const file = await put(r, "sessions/rollout.jsonl.zst", compressed);
    await expect(new ScanTracker(() => {}).begin([file.slice(0, -4)])).resolves.toBeUndefined();
    const read = async (p: string) => { const rows: string[] = []; for await (const line of codexRolloutLines(p)) rows.push(line); return rows; };
    expect((await read(file.slice(0, -4))).length).toBe(3);
    await fs.unlink(file); await put(r, "sessions/rollout.jsonl", await fs.readFile(fixture("rollout.jsonl")));
    expect((await read(file)).length).toBe(3);
    await fs.writeFile(file, "invalid zstd");
    await expect(read(file)).rejects.toThrow();
  });
});
