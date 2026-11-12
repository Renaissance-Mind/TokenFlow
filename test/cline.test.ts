import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { collectLocalUsage } from "../src/file-scan.js";
import { aggregateEvents } from "../src/usage-buckets.js";
import { toUsageSnapshotPayload } from "../src/ingest-payload.js";
import { parseClineDocument } from "../src/sources/cline.js";
const env = { ...process.env }, homes: string[] = [];
it("keeps bare-model precedence separate from an explicitly qualified model", () => {
  const events = parseClineDocument({ messages: ["custom", "vendor/custom"].map(id => ({ role: "assistant", ts: 1793491260000, modelInfo: { id, provider: "vendor" }, metrics: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } })) }, { file: "/fixture/session.messages.json", kind: "cli", session: "same" });
  const profiles = ["custom", "vendor/custom"].map((modelId, index) => ({ modelId, displayName: modelId, inputUsdPerMillion: index ? "10" : "1", outputUsdPerMillion: index ? "10" : "1", cacheReadUsdPerMillion: "0", cacheCreationUsdPerMillion: "0" }));
  expect(aggregateEvents(events, profiles).map(bucket => bucket.cost.totalUsd)).toEqual(["0.000011", "0.000110"]);
});
afterEach(async () => { process.env = { ...env }; for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }); });
it.each([false, true])("collects official Cline extension and CLI fixtures with custom roots %s", async custom => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-cline-")); homes.push(home);
  process.env = { PATH: env.PATH, HOME: home, TMPDIR: os.tmpdir(), CODEX_HOME: path.join(home, ".codex") };
  const root = custom ? path.join(home, "custom") : path.join(home, ".cline");
  for (const [fixture, relative] of [["extension/ui_messages.json", "tasks/session-a/ui_messages.json"], ["extension/legacy_cli_ui_messages.json", "data/tasks/session-a/ui_messages.json"], ["cli/session.messages.json", "data/sessions/session-a/session-a.messages.json"]]) {
    const target = path.join(root, relative); await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(new URL(`./fixtures/cline/${fixture}`, import.meta.url), target);
  }
  if (custom) process.env.CLINE_DATA_DIR = `${root},${path.join(root, "data")},${root}`;
  const result = await collectLocalUsage(home), events = result.events.filter(event => event.agent === "cline");
  expect(events).toHaveLength(4);
  expect(events.reduce((sum, event) => sum + event.totalTokens, 0)).toBe(398);
  expect(events.reduce((sum, event) => sum + event.inputTokens, 0)).toBe(263);
  expect(events.some(event => event.recordedCostUsd === "0")).toBe(true);
  expect(events.filter(event => event.sessionId === "cli:session-a")).toHaveLength(2);
  expect(result.sources.find(source => source.agent === "cline")?.files).toBe(3);
  expect(JSON.stringify(toUsageSnapshotPayload(aggregateEvents(events)))).not.toContain("hello");
  if (custom) { process.env.CLINE_DATA_DIR = " , "; expect((await collectLocalUsage(home)).events.filter(event => event.agent === "cline")).toHaveLength(0); }
});
