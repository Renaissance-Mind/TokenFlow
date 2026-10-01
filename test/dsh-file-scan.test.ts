import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectDshUsage } from "../src/sources/dsh.js";
import { collectLocalUsage } from "../src/file-scan.js";

const originalEnv = { ...process.env };
const temporary: string[] = [];
afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function root(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-dsh-"));
  temporary.push(value);
  return value;
}
const fixture = new URL("./fixtures/dsh/session.v3.jsonl.zstd", import.meta.url);

describe("dsh file discovery and compressed collection", () => {
  it("scans the official home through the normal collector", async () => {
    const home = await root();
    const sessions = path.join(home, ".dsh", "sessions", "--project--", "session-a");
    await fs.mkdir(sessions, { recursive: true });
    await fs.copyFile(fixture, path.join(sessions, "session.v3.jsonl.zstd"));
    delete process.env.DSH_HOME;
    delete process.env.DSH_SESSIONS_DIR;
    const result = await collectLocalUsage(home);
    expect(result.sources.find((source) => source.agent === "dsh")).toMatchObject({ files: 1, exists: true });
    expect(result.events.filter((event) => event.agent === "dsh")).toHaveLength(1);
    expect(result.events.find((event) => event.agent === "dsh")).toMatchObject({ totalTokens: 160, model: "deepseek-v4-flash" });
  });

  it("chooses the highest canonical generation and deduplicates mirrored logs", async () => {
    const store = await root();
    const first = path.join(store, "first", "--project--", "session-a");
    const mirror = path.join(store, "second", "--project--", "session-a");
    await fs.mkdir(first, { recursive: true });
    await fs.mkdir(mirror, { recursive: true });
    await fs.writeFile(path.join(first, "session.jsonl"), "INVALID_OLD_GENERATION\n");
    await fs.writeFile(path.join(first, "session.v03.jsonl"), "INVALID_NONCANONICAL\n");
    await fs.writeFile(path.join(first, "session.migration.tmp.jsonl"), "INVALID_TEMP\n");
    await fs.copyFile(fixture, path.join(first, "session.v3.jsonl.zstd"));
    await fs.copyFile(fixture, path.join(mirror, "session.v3.jsonl.zstd"));
    const result = await collectDshUsage([path.join(store, "first"), path.join(store, "second")]);
    expect(result.files).toHaveLength(2);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].totalTokens).toBe(160);
  });

  it("reads complete records in a live log and excludes a torn tail", async () => {
    const store = await root();
    const text = await fs.readFile(new URL("./fixtures/dsh/session.v3.jsonl", import.meta.url), "utf8");
    await fs.writeFile(path.join(store, "session.v3.jsonl"), text + '{"type":"assistant/message",');
    expect((await collectDshUsage([store])).events).toHaveLength(1);
    await fs.unlink(path.join(store, "session.v3.jsonl"));
    const compressed = await fs.readFile(fixture);
    await fs.writeFile(path.join(store, "session.v3.jsonl.zstd"), Buffer.concat([compressed, compressed.subarray(0, 10)]));
    expect((await collectDshUsage([store])).events).toHaveLength(1);
  });

  it("surfaces malformed committed records and unsupported future generations", async () => {
    const store = await root();
    await fs.writeFile(path.join(store, "session.v3.jsonl"), "NOT_JSON\n");
    await expect(collectDshUsage([store])).rejects.toThrow();
    await fs.writeFile(path.join(store, "session.v5.jsonl"), JSON.stringify({ type: "session", version: 5, id: "future" }) + "\n");
    await expect(collectDshUsage([store])).rejects.toThrow(/Unsupported dsh Session format 5/);
  });
});
