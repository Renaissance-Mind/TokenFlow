import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Decompress, type ZstdError } from "fzstd";

import { baseTotalsFromRecord, isRecord, makeUsageEvent, recordField, stringField } from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

// Verified against deepseek-ai/deepseek-harness 639ed015397290b3745d163aafe02ffee4aa3f84:
// Session format codecs (v0-v4) and llm/token-meter/src/usage-projection.ts.
const MAX_SESSION_FORMAT = 4;
const MAX_LINE_CHARS = 16 * 1024 * 1024;
const SESSION_FILE = /^session(?:\.v([1-9]\d*))?\.jsonl(?:\.zstd)?$/;

interface DshUsageEvent extends UsageEvent { eventSeq: number }
interface DshParser { pushLine(line: string): void; finish(): DshUsageEvent[] }

export function resolveDshSessionDirs(home: string, env = process.env): string[] {
  const expand = (value: string) => path.resolve(value === "~" ? home : value.startsWith("~/") ? path.join(home, value.slice(2)) : value);
  const explicit = env.DSH_SESSIONS_DIR?.trim();
  if (explicit) return [...new Set(explicit.split(",").map((value) => value.trim()).filter(Boolean).map(expand))];
  return [path.join(expand(env.DSH_HOME?.trim() || path.join(home, ".dsh")), "sessions")];
}

export function parseDshJsonl(jsonl: string, sourcePath: string): UsageEvent[] {
  const parser = createDshParser(sourcePath);
  for (const line of jsonl.split(/\r?\n/)) parser.pushLine(line);
  return parser.finish();
}

export function createDshParser(sourcePath: string): DshParser {
  let events: Array<DshUsageEvent | null> = [];
  let sessionId: string | null = null;
  let model: string | null = null;
  let seedLength = 0;
  let seeded = false;
  let sawSeedEnd = false;
  let last: { turn: unknown; step: unknown; index: number } | null = null;
  const filenameVersion = SESSION_FILE.exec(path.basename(sourcePath));

  return {
    pushLine(line): void {
      if (!line.trim()) return;
      const record: unknown = JSON.parse(line);
      if (!isRecord(record)) throw new Error(`Invalid dsh Session record in ${sourcePath}`);
      const type = stringField(record, "type");
      if (type === "session") {
        if (sessionId) throw new Error(`Duplicate dsh Session header in ${sourcePath}`);
        const version = record.version;
        if (typeof version !== "number" || !Number.isInteger(version) || version < 0 || version > MAX_SESSION_FORMAT) {
          throw new Error(`Unsupported dsh Session format ${version} in ${sourcePath}; update TokenFlow`);
        }
        if (filenameVersion && version !== Number(filenameVersion[1] || 0)) {
          throw new Error(`dsh Session filename/header version mismatch in ${sourcePath}`);
        }
        sessionId = stringField(record, "id");
        if (!sessionId) throw new Error(`dsh Session id missing in ${sourcePath}`);
        seedLength = typeof record.seedLength === "number" ? record.seedLength : 0;
        if (!Number.isSafeInteger(seedLength) || seedLength < 0) throw new Error(`Invalid dsh seedLength in ${sourcePath}`);
        seeded = record.isSeeded === true;
        return;
      }
      if (!sessionId) throw new Error(`dsh Session header missing in ${sourcePath}`);
      const data = recordField(record, "data");
      if (type === "request/header") {
        model = stringField(recordField(recordField(data, "header"), "config"), "model") || model;
      }
      if (type === "session/end-seed" && data?.inherited === true) {
        events = [];
        last = null;
        sawSeedEnd = true;
        return;
      }
      if (type === "llm/retry-started") {
        if (last?.turn === data?.turn && last?.step === data?.step) last = null;
        return;
      }
      if (!["assistant/message", "assistant/attempt", "assistant/chunk"].includes(type || "")) return;
      let usage = recordField(data, "usage");
      if (type === "assistant/chunk") {
        const chunk = recordField(data, "chunk");
        usage = chunk?.type === "usage" ? recordField(chunk, "usage") : null;
      } else if (!usage && Array.isArray(data?.stream)) {
        // Stream samples can be cumulative: only the final usage sample settles the call.
        for (const item of data.stream) {
          const chunk = isRecord(item) ? recordField(item, "chunk") : null;
          if (chunk?.type === "usage") usage = recordField(chunk, "usage");
        }
      }
      if (!usage) return;
      const seq = record.seq;
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0) throw new Error(`Invalid dsh usage seq in ${sourcePath}`);
      if (seq < seedLength) return;
      const timestamp = timestampFromMillis(record.time);
      if (!timestamp) throw new Error(`Invalid dsh usage timestamp in ${sourcePath}`);
      const message = recordField(data, "message");
      const event = makeUsageEvent({
        agent: "dsh", model: stringField(recordField(message, "source"), "model") || model,
        sessionId, sourcePath, timestamp,
        ...baseTotalsFromRecord(usage, {
          input: "inputTokens", output: "outputTokens", cacheRead: "cacheReadTokens",
          cacheCreation: "cacheWriteTokens", reasoning: "reasoningTokens", total: "totalTokens",
        }),
      });
      if (data?.turn === undefined || data.step === undefined) throw new Error(`dsh usage turn/step missing in ${sourcePath}`);
      const next = event ? { ...event, eventSeq: seq } : null;
      // Follow dsh's last-wins settlement slot; retries close the previous slot.
      if (last?.turn === data.turn && last.step === data.step) events[last.index] = next;
      else {
        last = { turn: data.turn, step: data.step, index: events.length };
        events.push(next);
      }
    },
    finish(): DshUsageEvent[] {
      if (seeded && !sawSeedEnd) throw new Error(`dsh inherited-history boundary missing in ${sourcePath}`);
      return events.filter((event): event is DshUsageEvent => event !== null);
    },
  };
}

export async function collectDshUsage(candidates: string[]): Promise<{ roots: string[]; files: string[]; events: UsageEvent[] }> {
  const roots: string[] = [];
  const generations = new Map<string, { version: number; files: string[] }>();
  for (const root of candidates) {
    const stat = await fs.stat(root).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stat?.isDirectory()) continue;
    roots.push(root);
    await discoverGenerations(root, generations);
  }
  const files = [...generations.values()].flatMap((generation) => generation.files).sort();
  const events = new Map<string, DshUsageEvent>();
  for (const file of files) {
    const parser = createDshParser(file);
    await readSessionLines(file, (line) => parser.pushLine(line));
    for (const event of parser.finish()) {
      const key = `${event.sessionId}:${event.eventSeq}`;
      const previous = events.get(key);
      if (previous) {
        const { sourcePath: _previousPath, ...left } = previous;
        const { sourcePath: _nextPath, ...right } = event;
        if (JSON.stringify(left) !== JSON.stringify(right)) throw new Error(`Conflicting copies of dsh usage ${key}`);
      } else events.set(key, event);
    }
  }
  return { roots, files, events: [...events.values()] };
}

async function discoverGenerations(directory: string, generations: Map<string, { version: number; files: string[] }>): Promise<void> {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await discoverGenerations(file, generations);
    if (!entry.isFile()) continue;
    const match = SESSION_FILE.exec(entry.name);
    if (!match) continue;
    const version = Number(match[1] || 0);
    const previous = generations.get(directory);
    if (!previous || version > previous.version) generations.set(directory, { version, files: [file] });
    else if (version === previous.version) previous.files.push(file);
  }
}

async function readSessionLines(file: string, onLine: (line: string) => void): Promise<void> {
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let pending = "";
  const consume = (chunk: Uint8Array) => {
    const text = utf8.decode(chunk, { stream: true });
    let start = 0;
    for (let end = text.indexOf("\n"); end !== -1; end = text.indexOf("\n", start)) {
      pending += text.slice(start, end);
      if (pending.length > MAX_LINE_CHARS) throw new Error(`dsh Session line too large in ${file}`);
      onLine(pending.endsWith("\r") ? pending.slice(0, -1) : pending);
      pending = "";
      start = end + 1;
    }
    pending += text.slice(start);
    if (pending.length > MAX_LINE_CHARS) throw new Error(`dsh Session line too large in ${file}`);
  };
  const decoder = file.endsWith(".zstd") ? new Decompress(consume) : null;
  for await (const chunk of createReadStream(file)) {
    if (decoder) decoder.push(chunk);
    else consume(chunk);
  }
  if (decoder) {
    try { decoder.push(new Uint8Array(), true); }
    catch (error) {
      // A live append may end in a torn frame. Keep only complete decoded JSONL rows.
      if ((error as ZstdError).code !== 5) throw error;
    }
  }
  // Uncommitted, unterminated tail lines are deliberately excluded, as in dsh's reader.
}

function timestampFromMillis(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
