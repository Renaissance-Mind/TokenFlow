import fs, { type FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cachedSource, type FileVersion } from "./collection-cache.js";
import { scannedBytes } from "./scan-progress.js";
import type { UsageEvent } from "./types.js";

export interface CheckpointParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
  snapshot(): unknown;
}
interface Checkpoint { version: FileVersion; offset: number; oversized: boolean; state: unknown; viewState?: unknown; events: UsageEvent[]; head: string; boundary: string }
const WINDOW = 4096;
const MAX_LINE = 16 * 1024 * 1024;
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function slice(handle: FileHandle, start: number, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length);
  const result = await handle.read(bytes, 0, length, start);
  return bytes.subarray(0, result.bytesRead);
}
function sameFile(previous: FileVersion | null | undefined, current: FileVersion): previous is FileVersion {
  return !!previous && previous.dev === current.dev && previous.ino === current.ino && previous.size < current.size;
}

// Checkpoints contain counters and parser context only, never transcript text.
export async function readIncrementalJsonl(file: string, create: (state?: unknown) => CheckpointParser, settings: unknown = null, includeTail = true): Promise<{ events: UsageEvent[]; state: unknown }> {
  const result = await cachedSource<Checkpoint>("jsonl-checkpoint", [file], async previous => {
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      const current: FileVersion = { file, dev: stat.dev, ino: stat.ino, size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs };
      const old = previous?.files[0];
      const resume = sameFile(old, current) && previous!.value.offset <= old.size
        && digest(await slice(handle, 0, Math.min(WINDOW, old.size))) === previous!.value.head
        && digest(await slice(handle, Math.max(0, old.size - WINDOW), Math.min(WINDOW, old.size))) === previous!.value.boundary;
      const head = digest(await slice(handle, 0, Math.min(WINDOW, stat.size)));
      const boundary = digest(await slice(handle, Math.max(0, stat.size - WINDOW), Math.min(WINDOW, stat.size)));
      const parser = create(resume ? structuredClone(previous!.value.state) : undefined);
      let offset = resume ? previous!.value.offset : 0;
      let oversized = resume ? previous!.value.oversized : false;
      let pending = Buffer.alloc(0);
      let consumed = 0;
      const stream = handle.createReadStream({ start: offset, end: Math.max(offset, stat.size - 1), autoClose: false });
      try {
        if (offset < stat.size) for await (const chunk of stream) {
          const bytes = Buffer.from(chunk); consumed += bytes.length; scannedBytes(file, consumed);
          let start = 0;
          for (let end = bytes.indexOf(10, start); end >= 0; end = bytes.indexOf(10, start)) {
            if (!oversized && pending.length + end - start <= MAX_LINE) {
              const line = Buffer.concat([pending, bytes.subarray(start, end)]).toString("utf8").replace(/\r$/, "");
              if (line.trim()) parser.pushLine(line);
            }
            offset += pending.length + end - start + 1;
            pending = Buffer.alloc(0); oversized = false; start = end + 1;
          }
          if (!oversized) {
            pending = Buffer.concat([pending, bytes.subarray(start)]);
            if (pending.length > MAX_LINE) { offset += pending.length; pending = Buffer.alloc(0); oversized = true; }
          } else offset += bytes.length - start;
        }
      } finally { stream.destroy(); }
      const state = parser.snapshot();
      const view = create(structuredClone(state));
      if (includeTail && !oversized && pending.length) {
        // Preview a valid EOF record, but commit only complete lines so a torn
        // append is read again from its start on the following collection.
        try { JSON.parse(pending.toString("utf8")); view.pushLine(pending.toString("utf8").replace(/\r$/, "")); }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      return { version: current, offset, oversized, state, viewState: view.snapshot(), events: view.finish(), head, boundary };
    } finally { await handle.close(); }
  }, [settings, includeTail], checkpoint => [checkpoint.version]);
  return { events: result.events, state: result.viewState ?? result.state };
}
