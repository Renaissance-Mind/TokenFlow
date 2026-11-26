import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { formatSessionUsage, readCodexSessionUsage } from "../src/session-usage.js";

const originalEnv = { ...process.env };
let home: string;
let codex: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-sessions-"));
  codex = path.join(home, ".codex");
  process.env = { PATH: originalEnv.PATH, HOME: home, USERPROFILE: home, TOKENFLOW_HOME: path.join(home, "data"), TOKENFLOW_SCAN_HOME: home };
  await fs.mkdir(path.join(codex, "sessions"), { recursive: true });
  await fs.mkdir(path.join(codex, "archived_sessions"), { recursive: true });
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await fs.rm(home, { recursive: true, force: true });
});

const meta = (payload: object) => ({ type: "session_meta", timestamp: "2026-10-01T00:00:00Z", payload });
const usage = (timestamp: string, input: number, model = "gpt-5") => ({
  timestamp, type: "event_msg", payload: { type: "token_count", info: { model, last_token_usage: { input_tokens: input, output_tokens: 20, cached_input_tokens: 50, total_tokens: input + 20 } } },
});
const lines = (...rows: object[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";

it("attributes only in-range usage to resumed, archived and forked sessions in the reporting timezone", async () => {
  const start = "2026-10-14T16:00:00Z";
  const shared = usage(start, 100);
  const projectPath = path.join(home, "a project");
  const main = lines(meta({ id: "parent", cwd: projectPath }),
    usage("2026-10-14T15:59:59Z", 200), shared, usage("2026-10-15T16:00:00Z", 200));
  await fs.writeFile(path.join(codex, "sessions", "parent.jsonl"), main);
  await fs.writeFile(path.join(codex, "archived_sessions", "parent.jsonl"), main);
  await fs.writeFile(path.join(codex, "archived_sessions", "child.jsonl"), lines(
    { ...meta({ id: "child", cwd: projectPath, forked_from_id: "parent" }), timestamp: start },
    usage("2026-10-14T15:59:59Z", 200), shared, usage("2026-10-14T16:02:00Z", 300, "unpriced-test-model"),
  ));
  await fs.writeFile(path.join(codex, "session_index.jsonl"), lines(
    { id: "parent", thread_name: "Old title" }, { id: "parent", thread_name: "Renamed session" },
  ) + '{"incomplete":');

  const report = await readCodexSessionUsage({ from: "2026-10-15", to: "2026-10-15", timeZone: "Asia/Singapore" });
  expect(report.sessions).toEqual([
    expect.objectContaining({ sessionId: "parent", title: "Renamed session", projectPath, totalTokens: 120, cachedInputTokens: 50, unpricedTokens: 0, firstUsedAt: "2026-10-14T16:00:00.000Z" }),
    expect.objectContaining({ sessionId: "child", parentSessionId: "parent", projectPath, totalTokens: 320, unpricedTokens: 320, costUsd: null }),
  ]);
  expect(report.projects).toEqual([expect.objectContaining({ projectPath, sessionCount: 2, totalTokens: 440, cachedInputTokens: 100, unpricedTokens: 320, costUsd: report.sessions[0].costUsd })]);
  expect(Number(report.totals.costUsd)).toBeGreaterThan(0);
  expect(report.totals.totalTokens).toBe(440);
  expect(formatSessionUsage(report)).toContain("320 unpriced tokens");
});

it("reads a completed collection until another pass and accounts for missing metadata on compressed rollouts", async () => {
  await fs.copyFile(new URL("fixtures/codex-compressed/rollout.jsonl.zst", import.meta.url),
    path.join(codex, "archived_sessions", "rollout.jsonl.zst"));
  await collectLocalUsage(home);
  const query = { from: "2026-10-14", to: "2026-10-14", timeZone: "UTC" };
  const completed = await readCodexSessionUsage(query);
  expect(completed.sessions).toEqual([expect.objectContaining({ sessionId: "compressed-parent", projectPath: null, totalTokens: 120 })]);
  expect(completed.projects).toEqual([expect.objectContaining({ projectPath: null, sessionCount: 1 })]);
  await fs.writeFile(path.join(codex, "sessions", "later.jsonl"), lines(
    meta({ id: "later", cwd: home }), usage("2026-10-14T12:00:00Z", 500),
  ));

  expect(await readCodexSessionUsage(query)).toEqual(completed);
  await collectLocalUsage(home);
  const updated = await readCodexSessionUsage(query);
  expect(updated.sessions.map(row => row.sessionId)).toEqual(["later", "compressed-parent"]);
  expect(updated.totals.totalTokens).toBe(640);
  expect(new Date(updated.scannedAt).getTime()).toBeGreaterThanOrEqual(new Date(completed.scannedAt).getTime());
  await expect(readCodexSessionUsage({ from: "2026-10-15", to: "2026-10-14" })).rejects.toThrow(RangeError);
});
