import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { createCodexJsonlParser, type CodexCheckpoint } from "../src/sources/codex.js";
import { dedupeCodexSessions } from "../src/sources/codex-replay.js";

const originalEnv = { ...process.env };
const homes: string[] = [];
afterEach(async () => {
  process.env = { ...originalEnv };
  for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true });
});

// Native shapes and scenarios from ccusage 2a84385 issue_1970 and loader tests.
const meta = (timestamp?: string) => ({ timestamp, type: "session_meta", payload: {
  id: "child", source: { subagent: { thread_spawn: { parent_thread_id: "missing-parent" } } },
} });
const usage = (timestamp: string, input: number, output: number, totalInput = input) => ({
  timestamp, type: "event_msg", payload: { type: "token_count", info: { model: "gpt-5",
    last_token_usage: { input_tokens: input, output_tokens: output, total_tokens: input + output },
    total_token_usage: { input_tokens: totalInput, output_tokens: output, total_tokens: totalInput + output },
  } },
});
async function collect(rows: object[]) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-codex-replay-"));
  homes.push(home);
  process.env = { PATH: originalEnv.PATH, HOME: home, TMPDIR: os.tmpdir(), CODEX_HOME: path.join(home, ".codex") };
  const dir = path.join(home, ".codex/sessions");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "rollout-child.jsonl"), rows.map(row => JSON.stringify(row)).join("\n"));
  return (await collectLocalUsage(home)).events.filter(event => event.agent === "codex");
}
describe("Codex first-response replay boundaries", () => {
  it("retains the raw replay probe across incremental parser checkpoints", () => {
    const options = { sourcePath: "/fixture/child.jsonl", useReplayPlan: true };
    const first = createCodexJsonlParser(options);
    first.pushLine(JSON.stringify(meta("2026-07-10T08:00:00Z")));
    first.pushLine(JSON.stringify(usage("2026-07-10T08:00:00.100Z", 100, 1)));
    const resumed = createCodexJsonlParser(options, structuredClone(first.snapshot()));
    resumed.pushLine(JSON.stringify(usage("2026-07-10T08:00:00.200Z", 100, 1)));
    resumed.pushLine(JSON.stringify(usage("2026-07-10T08:00:08Z", 50, 1)));
    const state = resumed.snapshot() as CodexCheckpoint;
    expect(dedupeCodexSessions([{ ...state.session!, events: resumed.finish(), compactions: new Map() }]).map(event => event.totalTokens)).toEqual([51]);
  });
  it("counts a late first response with repeated cumulative snapshots once", async () => {
    const events = await collect([meta("2026-01-05T15:00:00Z"),
      usage("2026-01-05T15:00:02Z", 1000, 10), usage("2026-01-05T15:00:02.150Z", 1000, 10)]);
    expect(events.map(event => event.totalTokens)).toEqual([1010]);
  });
  it("keeps distinct dense responses that start after the fork", async () => {
    const events = await collect([meta("2026-01-05T15:00:00Z"),
      usage("2026-01-05T15:00:02Z", 1000, 10), usage("2026-01-05T15:00:02.500Z", 2000, 20, 3000)]);
    expect(events.map(event => event.totalTokens)).toEqual([1010, 2020]);
  });
  it("suppresses duplicate-only replay at the known session start", async () => {
    const events = await collect([meta("2026-07-10T08:00:00Z"),
      usage("2026-07-10T08:00:00.100Z", 100, 1), usage("2026-07-10T08:00:00.200Z", 100, 1),
      usage("2026-07-10T08:00:08Z", 50, 1)]);
    expect(events.map(event => event.totalTokens)).toEqual([51]);
  });
  it("ignores zero initialization when probing replay", async () => {
    const events = await collect([meta("2026-07-10T08:00:00Z"),
      usage("2026-07-10T08:00:00.100Z", 0, 0), usage("2026-07-10T08:00:00.200Z", 0, 0),
      usage("2026-07-10T08:00:00.500Z", 50, 1)]);
    expect(events.map(event => event.totalTokens)).toEqual([51]);
  });
});
