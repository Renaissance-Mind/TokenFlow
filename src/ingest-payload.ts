import type { UsageBucket } from "./types.js";

export interface IngestPayload {
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
  }>;
}

export function toIngestPayload(buckets: UsageBucket[]): IngestPayload {
  return {
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
    })),
  };
}
