import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Deserializer } from "node:v8";

const CHECKSUM_BYTES = 32;
const RESULT_KEY_PREFIX = '["collection-result",[';
const v8StringEncodings: Record<string, BufferEncoding | undefined> = { '"': "latin1", c: "utf16le", S: "utf8" };

// Legacy entries start with a checksum and a V8 object whose first field is
// the JSON cache key. Inspect just that string, even for very large results.
function resultKeyHeader(bytes: Buffer) {
  const reader = new Deserializer(bytes);
  try {
    reader.readHeader();
    if (reader.readRawBytes(1).toString() !== "o" || reader.readValue() !== "key") return;
    let tag = reader.readRawBytes(1)[0];
    while (tag === 0) tag = reader.readRawBytes(1)[0]; // V8 string alignment padding
    const encoding = v8StringEncodings[String.fromCharCode(tag)];
    if (!encoding) return;
    const length = reader.readUint32();
    const start = reader.readRawBytes(0).byteOffset - bytes.byteOffset;
    const prefix = Buffer.from(RESULT_KEY_PREFIX, encoding);
    if (length >= prefix.length && reader.readRawBytes(prefix.length).equals(prefix)) {
      return { start: CHECKSUM_BYTES + start, length, encoding } as const;
    }
  } catch {
    // Truncated entries and unknown V8 formats cannot be identified safely.
  }
}

async function legacyResultMtime(file: string, expectedHash: string): Promise<number | undefined> {
  const handle = await fs.open(file, "r");
  try {
    const bytes = Buffer.alloc(96);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, CHECKSUM_BYTES);
    const key = resultKeyHeader(bytes.subarray(0, bytesRead));
    if (!key) return;
    const stat = await handle.stat();
    if (key.start + key.length > stat.size) return;
    const digest = createHash("sha256");
    const stream = handle.createReadStream({
      start: key.start, end: key.start + key.length - 1, encoding: key.encoding, autoClose: false,
    });
    for await (const chunk of stream) digest.update(chunk);
    if (digest.digest("hex") === expectedHash) return stat.mtimeMs;
  } finally { await handle.close(); }
}

async function directoryStamp(directory: string): Promise<string> {
  return (await fs.stat(directory, { bigint: true })).mtimeNs.toString();
}

async function markPruned(directory: string): Promise<void> {
  const marker = directory + ".results-pruned";
  await fs.rm(marker, { force: true });
  await fs.writeFile(marker, await directoryStamp(directory), { flag: "wx", mode: 0o600 });
}

function skipInaccessible(error: NodeJS.ErrnoException): undefined {
  if (!["ENOENT", "EACCES", "EPERM", "EROFS"].includes(error.code ?? "")) throw error;
}

async function pruneRevision(directory: string, hasMarker: boolean, signal?: AbortSignal) {
  if (hasMarker && await fs.readFile(directory + ".results-pruned", "utf8") === await directoryStamp(directory)) return;
  let newest: { file: string; mtime: number } | undefined;
  let complete = true;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    signal?.throwIfAborted();
    const match = /^([a-f0-9]{64})\.bin(?:\.\d+\.tmp)?$/.exec(entry.name);
    if (!entry.isFile() || !match) continue;
    const file = path.join(directory, entry.name);
    const mtime = await legacyResultMtime(file, match[1]).catch(error => {
      complete = false;
      return skipInaccessible(error);
    });
    if (mtime === undefined) continue;
    if (entry.name.endsWith(".tmp") || (newest && newest.mtime >= mtime)) {
      await fs.unlink(file);
    } else {
      if (newest) await fs.unlink(newest.file);
      newest = { file, mtime };
    }
  }
  // Recover space before rebuilding, keeping each old parser's last result
  // available to it if the new collection is interrupted.
  if (!newest) {
    if (complete) await markPruned(directory);
    return;
  }
  const retained = newest.file;
  return async () => {
    await fs.unlink(retained);
    if (complete) await markPruned(directory);
  };
}

// Called under the same writer lock as old clients. Their atomic renames
// change the directory mtime, so a later legacy write schedules another pass.
export async function pruneLegacyCollectionResults(root: string, signal?: AbortSignal) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const markers = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  const pending: Array<() => Promise<void>> = [];
  for (const revision of entries) {
    if (!revision.isDirectory() || !/^[a-f0-9]{64}$/.test(revision.name)) continue;
    const finish = await pruneRevision(path.join(root, revision.name), markers.has(revision.name + ".results-pruned"), signal)
      .catch(skipInaccessible);
    if (finish) pending.push(finish);
  }
  return async () => {
    for (const finish of pending) await finish().catch(skipInaccessible);
  };
}
