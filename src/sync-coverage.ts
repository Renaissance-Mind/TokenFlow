import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Decompress } from "fzstd";
import { aggregateEvents } from "./usage-buckets.js";
import { toUsageSnapshotPayload, type UsageSnapshotDay } from "./ingest-payload.js";
import type { PricingProfile } from "./types.js";
import path from "node:path";
import { createHash } from "node:crypto";
import { tokenUsageDir } from "./config.js";
import type { UsageEvent } from "./types.js";

// Bump with accounting/parser fixes. A new revision forces historical uploads;
// the server permits decreases only with complete, non-truncated source coverage.
export const ACCOUNTING_REVISION = 1;
export interface SourceProof { id: string; bytes: number; digest: string; prefix_bytes?: number; prefix_digest?: string; revision?: number; daily?: UsageSnapshotDay[] }
export interface Coverage { agent: string; day: string; revision: number; sources: Array<SourceProof> }
export interface CoverageState { revision: number; scopes: Coverage[] }
export const coverageKey = (row: { agent: string; day: string }): string => `${row.agent}\0${row.day}`;
const canonicalPath = (file: string): string => file.replace(/\.jsonl\.zst$/, ".jsonl").replace(/\/(?:archived_sessions|sessions)\//, "/rollouts/");
const sourceId = (file: string): string => createHash("sha256").update(canonicalPath(file)).digest("hex");

export async function readCoverageState(home?: string): Promise<CoverageState> {
  const raw = await fs.readFile(path.join(tokenUsageDir(home), "sync-coverage.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  return raw ? JSON.parse(raw) as CoverageState : { revision: 0, scopes: [] };
}
export async function writeCoverageState(state: CoverageState, home?: string): Promise<void> {
  const file = path.join(tokenUsageDir(home), "sync-coverage.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state), { mode: 0o600 });
  await fs.rename(tmp, file);
}

export async function collectCoverage(events: UsageEvent[], scannedFiles: string[], previous: CoverageState, pricing: PricingProfile[] = [], home?: string): Promise<Coverage[]> {
  const sources = new Map<string, SourceProof>();
  const priorSources = new Map(previous.scopes.flatMap(scope => scope.sources).map(source => [source.id, source]));
  const proofFile = path.join(tokenUsageDir(home), "sync-source-proofs.json");
  const raw = await fs.readFile(proofFile, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  const cached: Record<string, { signature: string; proof: SourceProof }> = raw ? JSON.parse(raw) : {};
  const next: typeof cached = {};
  // Hash once per changed file; never re-read unchanged transcript text. Digests
  // prove old bytes are still present, including truncate-and-regrow rotations.
  for (let index = 0; index < scannedFiles.length; index += 4) {
    await Promise.all(scannedFiles.slice(index, index + 4).map(async file => {
      const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
      if (!stat || !stat.isFile()) return;
      const id = sourceId(file);
      const prior = priorSources.get(id);
      const signature = JSON.stringify([stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, prior?.bytes]);
      let proof = cached[id]?.signature === signature ? cached[id].proof : undefined;
      if (!proof) {
        const full = createHash("sha256"), prefix = createHash("sha256");
        let consumed = 0, logical = 0;
        const consume = (buffer: Uint8Array) => {
          full.update(buffer);
          if (prior && logical < prior.bytes) prefix.update(buffer.subarray(0, Math.min(buffer.length, prior.bytes - logical)));
          logical += buffer.length;
        };
        const decoder = file.endsWith(".jsonl.zst") ? new Decompress(consume) : null;
        if (stat.size) for await (const chunk of createReadStream(file, { end: stat.size - 1 })) {
          const buffer = chunk as Buffer;
          if (decoder) decoder.push(buffer); else consume(buffer);
          consumed += buffer.length;
        }
        if (decoder) decoder.push(new Uint8Array(), true);
        // A file removed/truncated while hashing supplies no correction proof.
        if (consumed !== stat.size) return;
        proof = { id, bytes: logical, digest: full.digest("hex"),
          ...(prior && prior.bytes <= logical ? { prefix_bytes: prior.bytes, prefix_digest: prefix.digest("hex") } : {}) };
      }
      sources.set(id, proof);
      next[id] = { signature, proof };
    }));
  }
  await fs.mkdir(path.dirname(proofFile), { recursive: true });
  const tmp = `${proofFile}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
  await fs.rename(tmp, proofFile);
  return coverageFromSources(events, sources, previous, pricing);
}

export function coverageFromSources(events: UsageEvent[], sources: Map<string, SourceProof>, previous: CoverageState, pricing: PricingProfile[] = []): Coverage[] {
  const scopes = new Map<string, { agent: string; day: string; ids: Set<string>; unknown: boolean }>();
  const get = (agent: string, day: string) => {
    const key = coverageKey({ agent, day });
    if (!scopes.has(key)) scopes.set(key, { agent, day, ids: new Set(), unknown: false });
    return scopes.get(key)!;
  };
  // Keep old day associations for present sources, including days that now
  // correctly emit no events. Missing source IDs deliberately fail server proof.
  for (const old of previous.scopes) {
    const scope = get(old.agent, old.day);
    for (const source of old.sources) if (sources.has(source.id)) scope.ids.add(source.id);
  }
  const groupedEvents = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const eventKey = coverageKey({ agent: event.agent, day: event.bucketStart.slice(0, 10) }) + "\0" + sourceId(event.sourcePath);
    if (!groupedEvents.has(eventKey)) groupedEvents.set(eventKey, []);
    groupedEvents.get(eventKey)!.push(event);
    const scope = get(event.agent, event.bucketStart.slice(0, 10));
    const id = sourceId(event.sourcePath);
    if (sources.has(id)) scope.ids.add(id); else scope.unknown = true;
  }
  return [...scopes.values()].filter(scope => !scope.unknown && scope.ids.size).map(scope => ({
    agent: scope.agent, day: scope.day, revision: ACCOUNTING_REVISION,
    sources: [...scope.ids].sort().map(id => ({ ...sources.get(id)!, revision: ACCOUNTING_REVISION,
      daily: toUsageSnapshotPayload(aggregateEvents(groupedEvents.get(coverageKey(scope) + "\0" + id) || [], pricing)).daily })),
  })).sort((a, b) => coverageKey(a).localeCompare(coverageKey(b)));
}
