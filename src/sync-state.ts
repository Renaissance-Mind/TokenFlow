import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import { tokenUsageDir } from "./config.js";
import type { DailyReplacementScope, UnknownReplacementScope } from "./ingest-payload.js";
import type { UsageBucket } from "./types.js";

const SYNC_STATE_VERSION = 3;
const DEFAULT_MAX_BUCKETS_PER_SYNC = 60;

export interface BucketSyncRecord {
  hash: string;
  uploadedAt: string;
}

export interface ReplacementSyncRecord {
  uploadedAt: string;
}

export interface SyncState {
  version: 3;
  buckets: Record<string, BucketSyncRecord>;
  dailyReplacements: Record<string, ReplacementSyncRecord>;
  unknownDailyReplacements: Record<string, ReplacementSyncRecord>;
}

interface StoredSyncState {
  version?: number;
  buckets?: Record<string, BucketSyncRecord>;
  dailyReplacements?: Record<string, ReplacementSyncRecord>;
  unknownDailyReplacements?: Record<string, ReplacementSyncRecord>;
}

export interface IncrementalSyncPlan {
  buckets: UsageBucket[];
  replaceDailyBuckets: DailyReplacementScope[];
  replaceUnknownBuckets: UnknownReplacementScope[];
}

export function syncStatePath(home = os.homedir()): string {
  return path.join(tokenUsageDir(home), "sync-state.json");
}

export async function readSyncState(home = os.homedir()): Promise<SyncState> {
  const raw = await fs.readFile(syncStatePath(home), "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  });
  if (!raw) return emptySyncState();
  const parsed = JSON.parse(raw) as StoredSyncState;
  if (parsed.version === 1 || parsed.version === 2) return emptySyncState();
  if (parsed.version !== SYNC_STATE_VERSION) return emptySyncState();
  return {
    version: SYNC_STATE_VERSION,
    buckets: parsed.buckets || {},
    dailyReplacements: parsed.dailyReplacements || {},
    unknownDailyReplacements: parsed.unknownDailyReplacements || {},
  };
}

export async function writeSyncState(state: SyncState, home = os.homedir()): Promise<void> {
  const dir = tokenUsageDir(home);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${syncStatePath(home)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, syncStatePath(home));
}

export function emptySyncState(): SyncState {
  return {
    version: SYNC_STATE_VERSION,
    buckets: {},
    dailyReplacements: {},
    unknownDailyReplacements: {},
  };
}

export function planIncrementalSync(
  buckets: UsageBucket[],
  state: SyncState,
  options: { maxBuckets?: number } = {},
): IncrementalSyncPlan {
  const maxBuckets = Math.max(0, Math.floor(options.maxBuckets ?? maxBucketsPerSync()));
  const uniqueBuckets = dedupeBuckets(buckets);
  const changed = uniqueBuckets
    .filter((bucket) => state.buckets[bucketSyncKey(bucket)]?.hash !== bucketFingerprint(bucket))
    .sort(compareBucketsNewestFirst)
    .slice(0, maxBuckets);

  return {
    buckets: changed,
    replaceDailyBuckets: dailyReplacementScopes(uniqueBuckets, changed, state),
    replaceUnknownBuckets: unknownDailyReplacementScopes(uniqueBuckets, changed, state),
  };
}

export function markSyncPlanUploaded(state: SyncState, plan: IncrementalSyncPlan, uploadedAt: string): SyncState {
  const next: SyncState = {
    version: SYNC_STATE_VERSION,
    buckets: { ...state.buckets },
    dailyReplacements: { ...state.dailyReplacements },
    unknownDailyReplacements: { ...state.unknownDailyReplacements },
  };
  for (const bucket of plan.buckets) {
    next.buckets[bucketSyncKey(bucket)] = {
      hash: bucketFingerprint(bucket),
      uploadedAt,
    };
  }
  for (const scope of plan.replaceDailyBuckets) {
    next.dailyReplacements[dailyReplacementKey(scope.agent, scope.model, scope.bucket_start)] = { uploadedAt };
  }
  for (const scope of plan.replaceUnknownBuckets) {
    if (scope.granularity === "day") {
      next.unknownDailyReplacements[unknownDailyReplacementKey(scope.agent, scope.bucket_start)] = { uploadedAt };
    }
  }
  return next;
}

export function bucketSyncKey(bucket: UsageBucket): string {
  return ["half_hour", bucket.agent, bucket.model, bucket.bucketStart].join("\t");
}

export function bucketFingerprint(bucket: UsageBucket): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        inputTokens: bucket.inputTokens,
        cachedInputTokens: bucket.cachedInputTokens,
        outputTokens: bucket.outputTokens,
        reasoningOutputTokens: bucket.reasoningOutputTokens,
        cacheCreationTokens: bucket.cacheCreationTokens,
        totalTokens: bucket.totalTokens,
        cost: bucket.cost,
        pricingStatus: bucket.pricingStatus,
      }),
    )
    .digest("hex");
}

function dailyReplacementScopes(
  allBuckets: UsageBucket[],
  selectedBuckets: UsageBucket[],
  state: SyncState,
): DailyReplacementScope[] {
  const selectedKeys = new Set(selectedBuckets.map(bucketSyncKey));
  const groups = groupBuckets(allBuckets, (bucket) => dailyReplacementKey(bucket.agent, bucket.model, dayStart(bucket.bucketStart)));
  const scopes: DailyReplacementScope[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const day = dayStart(first.bucketStart);
    const key = dailyReplacementKey(first.agent, first.model, day);
    if (state.dailyReplacements[key]) continue;
    if (!group.some((bucket) => selectedKeys.has(bucketSyncKey(bucket))) && group.every((bucket) => isBucketUploaded(state, bucket))) {
      scopes.push({ agent: first.agent, model: first.model, bucket_start: day });
      continue;
    }
    if (group.every((bucket) => selectedKeys.has(bucketSyncKey(bucket)) || isBucketUploaded(state, bucket))) {
      scopes.push({ agent: first.agent, model: first.model, bucket_start: day });
    }
  }

  return scopes.sort(compareDailyScopes);
}

function unknownDailyReplacementScopes(
  allBuckets: UsageBucket[],
  selectedBuckets: UsageBucket[],
  state: SyncState,
): UnknownReplacementScope[] {
  const selectedKeys = new Set(selectedBuckets.map(bucketSyncKey));
  const groups = groupBuckets(allBuckets.filter((bucket) => bucket.agent === "codex"), (bucket) =>
    unknownDailyReplacementKey(bucket.agent, dayStart(bucket.bucketStart)),
  );
  const scopes: UnknownReplacementScope[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;
    const day = dayStart(first.bucketStart);
    const key = unknownDailyReplacementKey(first.agent, day);
    if (state.unknownDailyReplacements[key]) continue;
    if (group.some((bucket) => bucket.model === "unknown")) continue;
    if (!group.every((bucket) => selectedKeys.has(bucketSyncKey(bucket)) || isBucketUploaded(state, bucket))) continue;
    scopes.push({ agent: first.agent, bucket_start: day, granularity: "day" });
  }

  return scopes.sort((a, b) => a.bucket_start.localeCompare(b.bucket_start) || a.agent.localeCompare(b.agent));
}

function dedupeBuckets(buckets: UsageBucket[]): UsageBucket[] {
  const byKey = new Map<string, UsageBucket>();
  for (const bucket of buckets) byKey.set(bucketSyncKey(bucket), bucket);
  return [...byKey.values()];
}

function isBucketUploaded(state: SyncState, bucket: UsageBucket): boolean {
  return state.buckets[bucketSyncKey(bucket)]?.hash === bucketFingerprint(bucket);
}

function groupBuckets<T extends UsageBucket>(buckets: T[], keyFor: (bucket: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const bucket of buckets) {
    const key = keyFor(bucket);
    const group = groups.get(key) || [];
    group.push(bucket);
    groups.set(key, group);
  }
  return groups;
}

function compareBucketsNewestFirst(a: UsageBucket, b: UsageBucket): number {
  return (
    b.bucketStart.localeCompare(a.bucketStart) ||
    a.agent.localeCompare(b.agent) ||
    a.model.localeCompare(b.model)
  );
}

function compareDailyScopes(a: DailyReplacementScope, b: DailyReplacementScope): number {
  return (
    a.bucket_start.localeCompare(b.bucket_start) ||
    a.agent.localeCompare(b.agent) ||
    a.model.localeCompare(b.model)
  );
}

function dayStart(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new Error(`Invalid bucketStart: ${timestamp}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function dailyReplacementKey(agent: string, model: string, bucketStart: string): string {
  return ["day", agent, model, bucketStart].join("\t");
}

function unknownDailyReplacementKey(agent: string, bucketStart: string): string {
  return ["unknown-day", agent, bucketStart].join("\t");
}

function maxBucketsPerSync(): number {
  const value = Number(
    process.env.TOKENFLOW_SYNC_MAX_BUCKETS || process.env.TOKENUSAGE_SYNC_MAX_BUCKETS || DEFAULT_MAX_BUCKETS_PER_SYNC,
  );
  if (!Number.isFinite(value) || value < 1) return DEFAULT_MAX_BUCKETS_PER_SYNC;
  return Math.floor(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
