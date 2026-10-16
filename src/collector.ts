import { publishLocalCache } from "./local-cache.js";
import type { ScanProgress } from "./scan-progress.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { lock } from "proper-lockfile";
import { ingestUsageSnapshot, syncPing } from "./api.js";
import { normalizeServerUrl, readConfig, tokenUsageDir, writeConfig } from "./config.js";
import { collectLocalUsage, type CollectionResult } from "./file-scan.js";
import { refreshPricingCatalog } from "./server-pricing-catalog.js";
import { markSyncPlanUploaded, planIncrementalSync, readSyncState, writeSyncState } from "./sync-state.js";
import { aggregateEvents } from "./usage-buckets.js";
import type { UsageBucket } from "./types.js";

export interface SyncResult {
  events: number;
  collection: CollectionResult;
  buckets: UsageBucket[];
  sources: CollectionResult["sources"];
  uploaded: number;
  updated: number;
  lastSyncAt: string;
  warning?: string;
}
export interface SyncOptions {
  signal?: AbortSignal;
  serverUrl?: string;
  home?: string;
  onProgress?: (progress: ScanProgress) => void;
  onPhase?: (phase: "scan" | "pricing" | "upload") => void;
  onCollected?: (collection: CollectionResult) => Promise<void>;
}

export async function acquireSyncLock(wait = false): Promise<(() => Promise<void>) | null> {
  await fs.mkdir(tokenUsageDir(), { recursive: true });
  return lock(path.join(tokenUsageDir(), "sync"), { realpath: false, retries: wait ? { retries: 120, minTimeout: 100, maxTimeout: 500 } : 0, stale: 120_000, update: 30_000 })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ELOCKED") return null;
      throw error;
    });
}

export async function desktopAgentIsRunning(): Promise<boolean> {
  const raw = await fs.readFile(path.join(tokenUsageDir(), "desktop-agent.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!raw) return false;
  const marker = JSON.parse(raw) as { pid: number; updatedAt: string };
  if (Date.now() - Date.parse(marker.updatedAt) > 120_000) return false;
  try { process.kill(marker.pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}

export async function syncLocalUsage(options: SyncOptions = {}): Promise<SyncResult | null> {
  const release = await acquireSyncLock();
  if (!release) return null;
  try { return await syncLocalUsageWithHeldLock(options); }
  finally { await release(); }
}

// Desktop holds the lock in the parent process so stopping its worker releases
// only its own lock, without leaving a stale lock or disturbing a running CLI.
export async function syncLocalUsageWithHeldLock(options: SyncOptions = {}): Promise<SyncResult> {
  const config = await readConfig();
  const uploadToken = config?.apiToken || config?.deviceToken;
  if (!config || !uploadToken) throw new Error("Not logged in. Run tokenflow login first.");
  const serverUrl = normalizeServerUrl(options.serverUrl || config.serverUrl);
  const deviceName = config.deviceName || os.hostname();
  options.onPhase?.("scan");
  const collection = await collectLocalUsage(options.home, options.onProgress, options.signal);
  await publishLocalCache(collection, config);
  await options.onCollected?.(collection);
  options.signal?.throwIfAborted();
  options.onPhase?.("pricing");
  const pricing = await refreshPricingCatalog(serverUrl);
  const buckets = aggregateEvents(collection.events, [...pricing.catalog?.profiles || [], ...collection.pricingProfiles]);
  await publishLocalCache(collection, config, buckets);
  const state = await readSyncState();
  const plan = planIncrementalSync(buckets, state, { maxBuckets: Number.MAX_SAFE_INTEGER });
  const authorization = await readConfig();
  if ((authorization?.apiToken || authorization?.deviceToken) !== uploadToken || authorization?.serverUrl !== config.serverUrl) throw new Error("Collector authorization changed during collection. Retry with the current account.");
  options.signal?.throwIfAborted();
  options.onPhase?.("upload");
  const result = plan.buckets.length
    ? await ingestUsageSnapshot({ serverUrl, uploadToken, deviceName, platform: process.platform, buckets })
    : { accepted: 0, updated: 0 };
  if (plan.buckets.length) await writeSyncState(markSyncPlanUploaded(state,
    { buckets, replaceDailyBuckets: [], replaceUnknownBuckets: [] }, new Date().toISOString()));
  await syncPing(serverUrl, uploadToken, { deviceName, platform: process.platform });
  const latest = await readConfig();
  if ((latest?.apiToken || latest?.deviceToken) !== uploadToken || latest?.serverUrl !== config.serverUrl) {
    throw new Error("Collector authorization changed during sync. Retry with the current account.");
  }
  const lastSyncAt = new Date().toISOString();
  await writeConfig({ ...latest!, serverUrl, lastSyncAt });
  return { events: collection.events.length, collection, buckets, sources: collection.sources, uploaded: result.accepted,
    updated: result.updated, lastSyncAt, warning: pricing.warning };
}
