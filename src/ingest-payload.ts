import type { UsageBucket } from "./types.js";

export interface UnknownReplacementScope {
  agent: string;
  bucket_start: string;
  granularity?: "half_hour" | "day";
}

export interface DailyReplacementScope {
  agent: string;
  model: string;
  bucket_start: string;
}

export interface IngestPayload {
  device_name?: string;
  platform?: string;
  bucket_granularity?: "half_hour";
  replace_unknown_buckets?: UnknownReplacementScope[];
  replace_daily_buckets?: DailyReplacementScope[];
  hourly: Array<{
    agent: string;
    model: string;
    granularity: "half_hour";
    bucket_start: string;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    cache_creation_tokens: number;
    total_tokens: number;
    input_cost_usd: string;
    output_cost_usd: string;
    cache_read_cost_usd: string;
    cache_creation_cost_usd: string;
    total_cost_usd: string;
    pricing_status: "priced" | "unpriced";
  }>;
}

export interface UsageSnapshotSlot {
  bucket_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  cache_creation_tokens: number;
  total_tokens: number;
  input_cost_usd: string;
  output_cost_usd: string;
  cache_read_cost_usd: string;
  cache_creation_cost_usd: string;
  total_cost_usd: string;
  pricing_status: "priced" | "unpriced";
}

export interface UsageSnapshotDay extends UsageSnapshotSlot {
  day: string;
  agent: string;
  model: string;
  unpriced_buckets: number;
  slots: UsageSnapshotSlot[];
}

export interface UsageSnapshotPayload {
  device_name?: string;
  platform?: string;
  snapshot_version: "daily-v1";
  daily: UsageSnapshotDay[];
}

export function toIngestPayload(
  buckets: UsageBucket[],
  metadata: {
    deviceName?: string;
    platform?: string;
    replaceUnknownBuckets?: UnknownReplacementScope[];
    replaceDailyBuckets?: DailyReplacementScope[];
  } = {},
): IngestPayload {
  return {
    ...(metadata.deviceName ? { device_name: metadata.deviceName } : {}),
    ...(metadata.platform ? { platform: metadata.platform } : {}),
    bucket_granularity: "half_hour",
    ...(metadata.replaceUnknownBuckets?.length ? { replace_unknown_buckets: metadata.replaceUnknownBuckets } : {}),
    ...(metadata.replaceDailyBuckets?.length ? { replace_daily_buckets: metadata.replaceDailyBuckets } : {}),
    hourly: buckets.map((bucket) => ({
      agent: bucket.agent,
      model: bucket.model,
      granularity: "half_hour",
      bucket_start: bucket.bucketStart,
      input_tokens: bucket.inputTokens,
      cached_input_tokens: bucket.cachedInputTokens,
      output_tokens: bucket.outputTokens,
      reasoning_output_tokens: bucket.reasoningOutputTokens,
      cache_creation_tokens: bucket.cacheCreationTokens,
      total_tokens: bucket.totalTokens,
      input_cost_usd: bucket.cost.inputUsd,
      output_cost_usd: bucket.cost.outputUsd,
      cache_read_cost_usd: bucket.cost.cacheReadUsd,
      cache_creation_cost_usd: bucket.cost.cacheCreationUsd,
      total_cost_usd: bucket.cost.totalUsd,
      pricing_status: bucket.pricingStatus,
    })),
  };
}

export function toUsageSnapshotPayload(
  buckets: UsageBucket[],
  metadata: { deviceName?: string; platform?: string } = {},
): UsageSnapshotPayload {
  const groups = new Map<string, UsageSnapshotDay>();
  for (const bucket of buckets) {
    const day = dayKey(bucket.bucketStart);
    const bucketStart = `${day}T00:00:00.000Z`;
    const key = `${day}\0${bucket.agent}\0${bucket.model}`;
    const group =
      groups.get(key) ||
      ({
        day,
        agent: bucket.agent,
        model: bucket.model,
        bucket_start: bucketStart,
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        cache_creation_tokens: 0,
        total_tokens: 0,
        input_cost_usd: "0.000000",
        output_cost_usd: "0.000000",
        cache_read_cost_usd: "0.000000",
        cache_creation_cost_usd: "0.000000",
        total_cost_usd: "0.000000",
        pricing_status: "priced",
        unpriced_buckets: 0,
        slots: [],
      } satisfies UsageSnapshotDay);
    const slot = snapshotSlot(bucket);
    group.input_tokens += slot.input_tokens;
    group.cached_input_tokens += slot.cached_input_tokens;
    group.output_tokens += slot.output_tokens;
    group.reasoning_output_tokens += slot.reasoning_output_tokens;
    group.cache_creation_tokens += slot.cache_creation_tokens;
    group.total_tokens += slot.total_tokens;
    group.input_cost_usd = addUsdStrings(group.input_cost_usd, slot.input_cost_usd);
    group.output_cost_usd = addUsdStrings(group.output_cost_usd, slot.output_cost_usd);
    group.cache_read_cost_usd = addUsdStrings(group.cache_read_cost_usd, slot.cache_read_cost_usd);
    group.cache_creation_cost_usd = addUsdStrings(group.cache_creation_cost_usd, slot.cache_creation_cost_usd);
    group.total_cost_usd = addUsdStrings(group.total_cost_usd, slot.total_cost_usd);
    if (slot.pricing_status === "unpriced") {
      group.pricing_status = "unpriced";
      group.unpriced_buckets += 1;
    }
    group.slots.push(slot);
    groups.set(key, group);
  }

  return {
    ...(metadata.deviceName ? { device_name: metadata.deviceName } : {}),
    ...(metadata.platform ? { platform: metadata.platform } : {}),
    snapshot_version: "daily-v1",
    daily: [...groups.values()]
      .map((group) => ({ ...group, slots: group.slots.sort((a, b) => a.bucket_start.localeCompare(b.bucket_start)) }))
      .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start) || a.agent.localeCompare(b.agent) || a.model.localeCompare(b.model)),
  };
}

export function unknownReplacementScopesForBuckets(buckets: UsageBucket[]): UnknownReplacementScope[] {
  const groups = new Map<
    string,
    {
      agent: string;
      bucket_start: string;
      hasKnown: boolean;
      hasUnknown: boolean;
    }
  >();

  for (const bucket of buckets) {
    if (bucket.agent !== "codex") continue;
    const key = replacementScopeKey(bucket.agent, bucket.bucketStart);
    const group = groups.get(key) || {
      agent: bucket.agent,
      bucket_start: bucket.bucketStart,
      hasKnown: false,
      hasUnknown: false,
    };
    if (bucket.model === "unknown") group.hasUnknown = true;
    else group.hasKnown = true;
    groups.set(key, group);
  }

  return [...groups.values()]
    .filter((group) => group.hasKnown && !group.hasUnknown)
    .map(({ agent, bucket_start }) => ({ agent, bucket_start, granularity: "half_hour" as const }))
    .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start) || a.agent.localeCompare(b.agent));
}

export function replacementScopeKey(agent: string, bucketStart: string): string {
  return `${agent}\0${bucketStart}`;
}

function snapshotSlot(bucket: UsageBucket): UsageSnapshotSlot {
  return {
    bucket_start: bucket.bucketStart,
    input_tokens: bucket.inputTokens,
    cached_input_tokens: bucket.cachedInputTokens,
    output_tokens: bucket.outputTokens,
    reasoning_output_tokens: bucket.reasoningOutputTokens,
    cache_creation_tokens: bucket.cacheCreationTokens,
    total_tokens: bucket.totalTokens,
    input_cost_usd: bucket.cost.inputUsd,
    output_cost_usd: bucket.cost.outputUsd,
    cache_read_cost_usd: bucket.cost.cacheReadUsd,
    cache_creation_cost_usd: bucket.cost.cacheCreationUsd,
    total_cost_usd: bucket.cost.totalUsd,
    pricing_status: bucket.pricingStatus,
  };
}

function dayKey(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new Error(`Invalid bucketStart: ${timestamp}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString().slice(0, 10);
}

function addUsdStrings(left: string, right: string): string {
  return formatMicroUsd(parseUsdToMicro(left) + parseUsdToMicro(right));
}

function parseUsdToMicro(value: string): bigint {
  const [whole, fraction = ""] = String(value || "0").split(".");
  return BigInt(whole || "0") * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
}

function formatMicroUsd(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}
