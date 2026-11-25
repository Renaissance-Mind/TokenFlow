import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { serialize } from "node:v8";
import { lock } from "proper-lockfile";
import { afterEach, beforeEach, expect, it } from "vitest";
import { cachedSource, withCollectionCache } from "../src/collection-cache.js";

const previousHome = process.env.TOKENFLOW_HOME;
let home: string;
let cache: string;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-result-"));
  process.env.TOKENFLOW_HOME = path.join(home, "data");
  cache = path.join(process.env.TOKENFLOW_HOME, "collection-cache");
});
afterEach(async () => {
  if (previousHome === undefined) delete process.env.TOKENFLOW_HOME;
  else process.env.TOKENFLOW_HOME = previousHome;
  await fs.rm(home, { recursive: true, force: true });
});

async function writeLegacy(revision: string, kind: string, inputs: string[], value: unknown) {
  const directory = path.join(cache, revision);
  await fs.mkdir(directory, { recursive: true });
  const key = JSON.stringify([kind, inputs, null]);
  const file = path.join(directory, createHash("sha256").update(key).digest("hex") + ".bin");
  const bytes = serialize({ key, files: inputs.map(() => null), value });
  await fs.writeFile(file, Buffer.concat([createHash("sha256").update(bytes).digest(), bytes]));
  return file;
}

it("prunes verified legacy results across revisions under the shared writer lock", async () => {
  const revision = "a".repeat(64), older = "b".repeat(64);
  const checkpoint = await writeLegacy(revision, "jsonl-checkpoint", ["collection-result"], { offset: 123 });
  const checkpointBytes = await fs.readFile(checkpoint);
  const one = await writeLegacy(revision, "collection-result", ["café.jsonl"], [1]);
  const two = await writeLegacy(older, "collection-result", ["会🧪".repeat(18_000)], [2]);
  const orphan = two + ".123.tmp";
  await fs.copyFile(two, orphan);
  const unknown = path.join(cache, older, "c".repeat(64) + ".bin");
  await fs.copyFile(one, unknown);
  const broken = path.join(cache, revision, "d".repeat(64) + ".bin");
  await fs.writeFile(broken, "unrecognized");
  const raw = path.join(home, "session.jsonl");
  await fs.writeFile(raw, "session contents");
  const read = () => withCollectionCache(home, () => cachedSource("collection-result", [raw], () => fs.readFile(raw, "utf8")));

  const release = await lock(path.join(cache, "writer"), { realpath: false });
  const pending = read();
  let presentWhileLocked: boolean;
  try {
    await delay(150);
    presentWhileLocked = [one, two, orphan].every(file => existsSync(file));
  } finally { await release(); }
  expect(await pending).toBe("session contents");
  expect(presentWhileLocked).toBe(true);
  expect([one, two, orphan].some(file => existsSync(file))).toBe(false);
  expect(await fs.readFile(checkpoint)).toEqual(checkpointBytes);
  expect(await fs.readFile(broken, "utf8")).toBe("unrecognized");
  expect(existsSync(unknown)).toBe(true);
  expect(await fs.readFile(raw, "utf8")).toBe("session contents");

  const late = await writeLegacy(revision, "collection-result", ["later"], [3]);
  expect(await read()).toBe("session contents");
  expect(existsSync(late)).toBe(false);
  expect(await fs.readFile(checkpoint)).toEqual(checkpointBytes);
});

it("retains the last legacy result until a replacement collection succeeds", async () => {
  const revision = "a".repeat(64);
  const old = await writeLegacy(revision, "collection-result", ["old"], [1]);
  await fs.utimes(old, 1, 1);
  const latest = await writeLegacy(revision, "collection-result", ["latest"], [2]);
  const bytes = await fs.readFile(latest);
  await expect(withCollectionCache(home, () => cachedSource("collection-result", [], () =>
    fs.readFile(path.join(home, "absent"))))).rejects.toMatchObject({ code: "ENOENT" });
  expect(existsSync(old)).toBe(false);
  expect(await fs.readFile(latest)).toEqual(bytes);
  await withCollectionCache(home, () => cachedSource("collection-result", [], async () => [3]));
  expect(existsSync(latest)).toBe(false);
});

it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("retries inaccessible legacy files without blocking current scans", async () => {
  const revision = "a".repeat(64);
  const unreadable = await writeLegacy(revision, "collection-result", ["unreadable"], [1]);
  const readable = await writeLegacy(revision, "collection-result", ["readable"], [2]);
  const read = () => withCollectionCache(home, () => cachedSource("collection-result", [], async () => [3]));
  await fs.chmod(unreadable, 0);
  try {
    expect(await read()).toEqual([3]);
    expect(existsSync(readable)).toBe(false);
    expect(existsSync(unreadable)).toBe(true);
  } finally { await fs.chmod(unreadable, 0o600); }
  expect(await read()).toEqual([3]);
  expect(existsSync(unreadable)).toBe(false);
});

it("validates input names and settings and preserves the last committed result on cancellation", async () => {
  const read = (input: string, settings: string, value: string) => withCollectionCache(home, () =>
    cachedSource("collection-result", [path.join(home, input)], async () => value, settings));
  expect(await read("missing-a", "a", "first")).toBe("first");
  expect(await read("missing-b", "a", "second")).toBe("second");
  expect(await read("missing-b", "b", "third")).toBe("third");
  const resultFile = path.join(cache, "collection-result.bin");
  const committed = await fs.readFile(resultFile);
  const controller = new AbortController();
  await expect(withCollectionCache(home, () => cachedSource("collection-result", [], async () => {
    controller.abort();
    return "interrupted";
  }), controller.signal)).rejects.toThrow();
  expect(await fs.readFile(resultFile)).toEqual(committed);
  expect(await read("missing-b", "b", "unexpected")).toBe("third");
});

it("returns oversized results without accumulating them on disk", async () => {
  const read = (size: number) => withCollectionCache(home, () =>
    cachedSource("collection-result", [], async () => Buffer.alloc(size), size));
  await read(16);
  const resultFile = path.join(cache, "collection-result.bin");
  expect(existsSync(resultFile)).toBe(true);
  const size = 256 * 1024 * 1024;
  expect((await read(size)).length).toBe(size);
  expect(existsSync(resultFile)).toBe(false);
  expect(existsSync(resultFile + ".tmp")).toBe(false);
  expect((await read(32)).length).toBe(32);
  expect((await fs.stat(resultFile)).size).toBeLessThan(1024);
});
