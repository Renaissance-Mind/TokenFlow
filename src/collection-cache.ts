import { AsyncLocalStorage } from "node:async_hooks";
import { serialize, deserialize } from "node:v8";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lock } from "proper-lockfile";
import { tokenUsageDir } from "./config.js";

export interface FileVersion { file: string; dev: number; ino: number; size: number; mtime: number; ctime: number }
export interface CachedSource<T> { files: Array<FileVersion | null>; value: T }
interface Entry<T> extends CachedSource<T> { key: string }
const context = new AsyncLocalStorage<CollectionCache>();
const depth = new AsyncLocalStorage<number>();
const memory = new Map<string, Map<string, { entry: Entry<unknown>; version: FileVersion | null }>>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let parserRevision: Promise<string> | undefined;

async function readText(file: string): Promise<string | null> {
  const handle = await fs.open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return null;
  try { return await handle.readFile("utf8"); } finally { await handle.close(); }
}
async function revision(): Promise<string> {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const files = ["file-scan", "pricing", "pricing-data", "arrays", "time", "token-totals", "incremental-jsonl", "collection-cache"];
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const sources = (await fs.readdir(path.join(root, "sources"))).filter(file => file.endsWith(extension)).sort();
  const content = await Promise.all([...files.map(file => path.join(root, file + extension)), ...sources.map(file => path.join(root, "sources", file))].map(readText));
  return hash(JSON.stringify([3, ...content]));
}
export async function fileVersion(file: string): Promise<FileVersion | null> {
  const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return stat ? { file, dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs } : null;
}

class CollectionCache {
  private roots: string[] = [];
  private memory: Map<string, { entry: Entry<unknown>; version: FileVersion | null }>;
  constructor(private directory: string, readonly signal?: AbortSignal) {
    if (!memory.has(directory)) memory.set(directory, new Map());
    this.memory = memory.get(directory)!;
  }
  revision(): string { return hash(JSON.stringify([this.directory, this.roots.sort()])); }
  async read<T>(key: string, files: string[], load: (previous?: CachedSource<T>) => Promise<T>, snapshotVersions?: (value: T) => Array<FileVersion | null>): Promise<T> {
    this.signal?.throwIfAborted();
    const name = hash(key) + ".bin";
    const file = path.join(this.directory, name);
    const versions = await Promise.all(files.map(fileVersion));
    const level = depth.getStore() || 0;
    if (!level) this.roots.push(JSON.stringify([key, versions]));
    const remembered = this.memory.get(name);
    const diskVersion = await fileVersion(file);
    if (remembered && diskVersion && JSON.stringify(diskVersion) === JSON.stringify(remembered.version)
      && JSON.stringify(remembered.entry.files) === JSON.stringify(versions)) return remembered.entry.value as T;
    let previous: Entry<T> | undefined;
    const handle = await fs.open(file, "r").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (handle) {
      let bytes: Buffer;
      try { bytes = await handle.readFile(); } finally { await handle.close(); }
      const payload = bytes.subarray(32);
      if (bytes.length > 32 && createHash("sha256").update(payload).digest().equals(bytes.subarray(0, 32))) {
        try { previous = deserialize(payload) as Entry<T>; }
        catch (error) { if (!(error instanceof Error) || !/deserializ|version|buffer/i.test(error.message)) throw error; }
      }
      if (!previous || previous.key !== key || !("value" in previous)) previous = undefined;
    }
    if (previous && JSON.stringify(previous.files) === JSON.stringify(versions)) {
      this.memory.set(name, { entry: previous, version: diskVersion });
      return previous.value;
    }
    const value = await depth.run(level + 1, () => load(previous));
    this.signal?.throwIfAborted();
    // Ordinary readers cache only stable inputs. Bounded JSONL readers commit
    // their captured prefix version so concurrent appends resume at its offset.
    if (snapshotVersions || JSON.stringify(versions) === JSON.stringify(await Promise.all(files.map(fileVersion)))) {
      const tmp = `${file}.${process.pid}.tmp`;
      const entry = { key, files: snapshotVersions ? snapshotVersions(value) : versions, value };
      const bytes = serialize(entry);
      const handle = await fs.open(tmp, "w", 0o600);
      try {
        await handle.writeFile(createHash("sha256").update(bytes).digest());
        await handle.writeFile(bytes);
      } finally { await handle.close(); }
      await fs.rename(tmp, file);
      this.memory.set(name, { entry, version: await fileVersion(file) });
    }
    return value;
  }

}

export function checkCollectionCancellation(): void { context.getStore()?.signal?.throwIfAborted(); }

export function collectionRevision(): string | undefined { return context.getStore()?.revision(); }

export function cachedSource<T>(kind: string, files: string[], load: (previous?: CachedSource<T>) => Promise<T>, settings: unknown = null, snapshotVersions?: (value: T) => Array<FileVersion | null>): Promise<T> {
  return context.getStore()?.read(JSON.stringify([kind, files, settings]), files, load, snapshotVersions) ?? load();
}
export async function withCollectionCache<T>(home: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const root = path.join(tokenUsageDir(home), "collection-cache");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  // One writer across App, manual CLI commands, and the background collector.
  const release = await lock(path.join(root, "writer"), { realpath: false, stale: 30_000, update: 5_000, retries: { retries: 120, minTimeout: 100, maxTimeout: 500 } });
  try {
    const directory = path.join(root, await (parserRevision ??= revision()));
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const cache = new CollectionCache(directory, signal);
    const result = await context.run(cache, action);
    return result;
  } finally { await release(); }
}
