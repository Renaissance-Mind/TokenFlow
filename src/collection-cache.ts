import { AsyncLocalStorage } from "node:async_hooks";
import { serialize, deserialize } from "node:v8";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lock } from "proper-lockfile";
import { tokenUsageDir } from "./config.js";
import { pruneLegacyCollectionResults } from "./legacy-collection-results.js";
import { physicalSourcePath, restoreSourceIssues, sourceIssueMarker, sourceIssuesSince, type SourceIssue } from "./source-input.js";

export interface FileVersion { file: string; dev: number; ino: number; size: number; mtime: number; ctime: number }
export interface CachedSource<T> { files: Array<FileVersion | null>; value: T; diagnostics?: SourceIssue[] }
interface Entry<T> extends CachedSource<T> { key: string }
const context = new AsyncLocalStorage<CollectionCache>();
const depth = new AsyncLocalStorage<number>();
const memory = new Map<string, Map<string, { entry: Entry<unknown>; version: FileVersion | null }>>();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const RESULT_FILE = "collection-result.bin";
const MAX_RESULT_BYTES = 256 * 1024 * 1024;
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
  const files = ["file-scan", "pricing", "pricing-resolver", "pricing-data", "arrays", "time", "token-totals", "incremental-jsonl", "source-input", "collection-cache"];
  const extension = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
  const sources = (await fs.readdir(path.join(root, "sources"))).filter(file => file.endsWith(extension)).sort();
  const content = await Promise.all([...files.map(file => path.join(root, file + extension)), ...sources.map(file => path.join(root, "sources", file))].map(readText));
  return hash(JSON.stringify([3, ...content]));
}
export async function fileVersion(file: string): Promise<FileVersion | null> {
  const stat = await fs.stat(physicalSourcePath(file)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return stat ? { file, dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs } : null;
}

async function readEntry<T>(file: string, key: string, inputDigest?: Buffer): Promise<Entry<T> | undefined> {
  const handle = await fs.open(file, "r").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!handle) return;
  let bytes: Buffer;
  try {
    if (inputDigest) {
      const stored = Buffer.alloc(inputDigest.length);
      const { bytesRead } = await handle.read(stored);
      if (bytesRead !== stored.length || !stored.equals(inputDigest)) return;
    }
    bytes = await handle.readFile();
  } finally { await handle.close(); }
  const payload = bytes.subarray(32);
  if (!payload.length || !createHash("sha256").update(payload).digest().equals(bytes.subarray(0, 32))) return;
  let entry: Entry<T>;
  try { entry = deserialize(payload); }
  catch (error) {
    if (!(error instanceof Error) || !/deserializ|version|buffer/i.test(error.message)) throw error;
    return;
  }
  if (entry?.key === key && Array.isArray(entry.files) && "value" in entry) return entry;
}

async function writeEntry<T>(file: string, entry: Entry<T>, inputDigest?: Buffer, signal?: AbortSignal): Promise<boolean> {
  const bytes = serialize(entry);
  if (inputDigest && inputDigest.length + 32 + bytes.length > MAX_RESULT_BYTES) {
    await fs.rm(file, { force: true });
    return false;
  }
  const checksum = createHash("sha256").update(bytes).digest();
  const tmp = inputDigest ? file + ".tmp" : `${file}.${process.pid}.tmp`;
  const handle = await fs.open(tmp, inputDigest ? "wx" : "w", 0o600);
  try {
    await fs.writeFile(handle, inputDigest ? [inputDigest, checksum, bytes] : [checksum, bytes], { signal })
      .finally(() => handle.close());
    signal?.throwIfAborted();
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  return true;
}

class CollectionCache {
  private roots: string[] = [];
  private memory: Map<string, { entry: Entry<unknown>; version: FileVersion | null }>;
  constructor(private directory: string, readonly signal?: AbortSignal) {
    if (!memory.has(directory)) memory.set(directory, new Map());
    this.memory = memory.get(directory)!;
  }
  revision(): string { return hash(JSON.stringify([this.directory, this.roots.sort()])); }
  async read<T>(kind: string, files: string[], load: (previous?: CachedSource<T>) => Promise<T>, settings: unknown, snapshotVersions?: (value: T) => Array<FileVersion | null>): Promise<T> {
    this.signal?.throwIfAborted();
    const isResult = kind === "collection-result";
    const directory = isResult ? path.dirname(this.directory) : this.directory;
    const finishMigration = isResult ? await pruneLegacyCollectionResults(directory, this.signal) : undefined;
    const key = JSON.stringify([kind, files, settings]);
    const versions = await Promise.all(files.map(fileVersion));
    const level = depth.getStore() || 0;
    const inputs = !level || isResult ? JSON.stringify([key, versions]) : "";
    if (!level) this.roots.push(inputs);
    // All parsers share one result file. Check its input digest before
    // reading the full payload on a cold cache lookup.
    const inputDigest = isResult ? createHash("sha256").update(this.directory).update(inputs).digest() : undefined;
    const name = isResult ? RESULT_FILE : hash(key) + ".bin";
    const file = path.join(directory, name);
    const remembered = this.memory.get(name);
    const diskVersion = await fileVersion(file);
    const versionKey = JSON.stringify(versions);
    if (remembered && remembered.entry.key === key && (diskVersion || isResult)
      && JSON.stringify(remembered.version) === JSON.stringify(diskVersion)
      && JSON.stringify(remembered.entry.files) === versionKey) {
      restoreSourceIssues(remembered.entry.diagnostics);
      await finishMigration?.();
      return remembered.entry.value as T;
    }
    if (isResult) this.memory.delete(name);
    const previous = diskVersion && (!isResult || diskVersion.size <= MAX_RESULT_BYTES)
      ? await readEntry<T>(file, key, inputDigest) : undefined;
    if (previous && JSON.stringify(previous.files) === versionKey) {
      this.memory.set(name, { entry: previous, version: diskVersion });
      restoreSourceIssues(previous.diagnostics);
      await finishMigration?.();
      return previous.value;
    }
    const marker = sourceIssueMarker();
    const value = await depth.run(level + 1, () => load(previous));
    const diagnostics = sourceIssuesSince(marker);
    this.signal?.throwIfAborted();
    // Ordinary readers cache only stable inputs. Bounded JSONL readers commit
    // their captured prefix version so concurrent appends resume at its offset.
    if (!diagnostics.some(issue => issue.category.startsWith("unreadable"))
      && (snapshotVersions || versionKey === JSON.stringify(await Promise.all(files.map(fileVersion))))) {
      const entry = { key, files: snapshotVersions ? snapshotVersions(value) : versions, value, diagnostics };
      const persisted = await writeEntry(file, entry, inputDigest, this.signal);
      this.memory.set(name, { entry, version: persisted ? await fileVersion(file) : null });
      await finishMigration?.();
    }
    return value;
  }

}

export function checkCollectionCancellation(): void { context.getStore()?.signal?.throwIfAborted(); }

export function collectionRevision(): string | undefined { return context.getStore()?.revision(); }

export function cachedSource<T>(kind: string, files: string[], load: (previous?: CachedSource<T>) => Promise<T>, settings: unknown = null, snapshotVersions?: (value: T) => Array<FileVersion | null>): Promise<T> {
  return context.getStore()?.read(kind, files, load, settings, snapshotVersions) ?? load();
}
export async function withCollectionCache<T>(home: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const root = path.join(tokenUsageDir(home), "collection-cache");
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  // One writer across App, manual CLI commands, and the background collector.
  const release = await lock(path.join(root, "writer"), { realpath: false, stale: 30_000, update: 5_000, retries: { retries: 120, minTimeout: 100, maxTimeout: 500 } });
  try {
    signal?.throwIfAborted();
    await fs.rm(path.join(root, RESULT_FILE + ".tmp"), { force: true });
    const parser = await (parserRevision ??= revision());
    const directory = path.join(root, "sources-" + parser);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const cache = new CollectionCache(directory, signal);
    const result = await context.run(cache, action);
    return result;
  } finally { await release(); }
}
