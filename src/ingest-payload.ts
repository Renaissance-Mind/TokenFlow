import type { UsageBucket } from "./types.js";

export interface UnknownReplacementScope {
  agent: string;
  bucket_start: string;
}

export interface IngestPayload {
  device_name?: string;
  platform?: string;
  replace_unknown_buckets?: UnknownReplacementScope[];
  hourly: Array<{
    agent: string;
    model: string;
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

export function toIngestPayload(
  buckets: UsageBucket[],
  metadata: { deviceName?: string; platform?: string; replaceUnknownBuckets?: UnknownReplacementScope[] } = {},
): IngestPayload {
  return {
    ...(metadata.deviceName ? { device_name: metadata.deviceName } : {}),
    ...(metadata.platform ? { platform: metadata.platform } : {}),
    ...(metadata.replaceUnknownBuckets?.length ? { replace_unknown_buckets: metadata.replaceUnknownBuckets } : {}),
    hourly: buckets.map((bucket) => ({
      agent: bucket.agent,
      model: bucket.model,
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
    .map(({ agent, bucket_start }) => ({ agent, bucket_start }))
    .sort((a, b) => a.bucket_start.localeCompare(b.bucket_start) || a.agent.localeCompare(b.agent));
}

export function replacementScopeKey(agent: string, bucketStart: string): string {
  return `${agent}\0${bucketStart}`;
}
