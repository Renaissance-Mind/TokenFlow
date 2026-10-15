import fs from "node:fs/promises";
import { Decompress, type ZstdError } from "fzstd";

export const plainRolloutPath = (file: string) => file.endsWith(".jsonl.zst") ? file.slice(0, -4) : file;
export const isCodexRollout = (file: string) => file.endsWith(".jsonl") || file.endsWith(".jsonl.zst");

async function openRollout(file: string) {
  try { return { handle: await fs.open(file, "r"), file }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const other = file.endsWith(".jsonl.zst") ? plainRolloutPath(file) : `${file}.zst`;
    return { handle: await fs.open(other, "r"), file: other };
  }
}

export async function codexRolloutStat(file: string) {
  const opened = await openRollout(file);
  try { return await opened.handle.stat(); }
  finally { await opened.handle.close(); }
}

async function* chunks(file: string, onBytes: (bytes: number) => void): AsyncGenerator<string> {
  const opened = await openRollout(file);
  const stream = opened.handle.createReadStream({ autoClose: false });
  const utf8 = new TextDecoder();
  const decoded: Uint8Array[] = [];
  const decoder = opened.file.endsWith(".jsonl.zst") ? new Decompress(chunk => decoded.push(chunk)) : null;
  try {
    for await (const raw of stream) {
      onBytes(stream.bytesRead);
      if (decoder) decoder.push(raw);
      else decoded.push(raw);
      for (const chunk of decoded.splice(0)) yield utf8.decode(chunk, { stream: true });
    }
    if (decoder) {
      try { decoder.push(new Uint8Array(), true); }
      catch (error) {
        // Live compression can leave an unfinished final frame; retain completed records.
        if ((error as ZstdError).code !== 5) throw error;
      }
    }
    for (const chunk of decoded) yield utf8.decode(chunk, { stream: true });
    const tail = utf8.decode();
    if (tail) yield tail;
  } finally {
    stream.destroy();
    await opened.handle.close();
  }
}

export async function* codexRolloutLines(file: string, onBytes: (bytes: number) => void = () => {}): AsyncGenerator<string> {
  let line = "", oversized = false;
  for await (const text of chunks(file, onBytes)) {
    let start = 0;
    while (start < text.length) {
      const newline = text.indexOf("\n", start), end = newline < 0 ? text.length : newline;
      if (!oversized) {
        line += text.slice(start, end);
        if (line.length > 16 * 1024 * 1024) { line = ""; oversized = true; }
      }
      if (newline < 0) break;
      if (!oversized) yield line.replace(/\r$/, "");
      line = ""; oversized = false; start = newline + 1;
    }
  }
  if (!oversized && line) yield line.replace(/\r$/, "");
}

export async function initialCodexSessionRecord(file: string): Promise<Record<string, unknown> | null> {
  let count = 0;
  for await (const line of codexRolloutLines(file)) {
    if (++count > 256) return null;
    if (!line.includes("session_meta")) continue;
    let row: unknown;
    try { row = JSON.parse(line); } catch { continue; }
    if (row && typeof row === "object" && "type" in row && row.type === "session_meta") return row as Record<string, unknown>;
  }
  return null;
}
