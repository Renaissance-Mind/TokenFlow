import { calculateCost, resolvePricing } from "./pricing.js";
import type { CostBreakdown, PricingProfile, UsageBucket, UsageEvent, UsageTotals } from "./types.js";

const ZERO_COST: CostBreakdown = {
  inputUsd: "0.000000",
  outputUsd: "0.000000",
  cacheReadUsd: "0.000000",
  cacheCreationUsd: "0.000000",
  totalUsd: "0.000000",
};

export function aggregateEvents(events: UsageEvent[], pricingProfiles: PricingProfile[] = []): UsageBucket[] {
  const buckets = new Map<string, UsageBucket>();

  for (const event of events) {
    const bucketStart = toUtcDayStart(event.bucketStart);
    const key = `${event.agent}|${event.model}|${bucketStart}`;
    const bucket =
      buckets.get(key) ||
      ({
        agent: event.agent,
        model: event.model,
        pricingModel: event.pricingModel,
        bucketStart,
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        extraTotalTokens: 0,
        totalTokens: 0,
        cost: ZERO_COST,
        pricingStatus: "unpriced",
      } satisfies UsageBucket);

    addTotals(bucket, event);
    bucket.pricingModel ||= event.pricingModel;
    bucket.recordedCostUsd = addUsdStrings(bucket.recordedCostUsd, event.recordedCostUsd);
    const pricing = calculateBucketCost(bucket, pricingProfiles);
    bucket.cost = pricing.cost;
    bucket.pricingStatus = pricing.status;
    buckets.set(key, bucket);
  }

  return Array.from(buckets.values()).sort((a, b) =>
    `${a.bucketStart}|${a.agent}|${a.model}`.localeCompare(`${b.bucketStart}|${b.agent}|${b.model}`),
  );
}

function calculateBucketCost(
  bucket: UsageBucket,
  pricingProfiles: PricingProfile[],
): { cost: CostBreakdown; status: "priced" | "unpriced" } {
  if (bucket.recordedCostUsd) {
    return {
      cost: {
        inputUsd: "0.000000",
        outputUsd: "0.000000",
        cacheReadUsd: "0.000000",
        cacheCreationUsd: "0.000000",
        totalUsd: bucket.recordedCostUsd,
      },
      status: "priced",
    };
  }
  const pricing = resolvePricing(bucket.pricingModel || bucket.model, pricingProfiles);
  if (!pricing) return { cost: ZERO_COST, status: "unpriced" };
  return { cost: calculateCost(bucket.agent, bucket, pricing, pricing.fastMultiplier), status: "priced" };
}

function addTotals(target: UsageTotals, delta: UsageTotals): void {
  target.inputTokens += delta.inputTokens;
  target.cachedInputTokens += delta.cachedInputTokens;
  target.outputTokens += delta.outputTokens;
  target.reasoningOutputTokens += delta.reasoningOutputTokens;
  target.cacheCreationTokens += delta.cacheCreationTokens;
  target.cacheCreation5mTokens = (target.cacheCreation5mTokens || 0) + (delta.cacheCreation5mTokens || 0);
  target.cacheCreation1hTokens = (target.cacheCreation1hTokens || 0) + (delta.cacheCreation1hTokens || 0);
  target.extraTotalTokens = (target.extraTotalTokens || 0) + (delta.extraTotalTokens || 0);
  target.totalTokens += delta.totalTokens;
}

function toUtcDayStart(timestamp: string): string {
  const date = new Date(timestamp);
  const time = date.getTime();
  if (!Number.isFinite(time)) throw new Error(`Invalid bucketStart: ${timestamp}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

function addUsdStrings(left: string | undefined, right: string | undefined): string | undefined {
  if (!right) return left;
  if (!left) return normalizeUsdString(right);
  return formatMicroUsd(parseUsdToMicro(left) + parseUsdToMicro(right));
}

function normalizeUsdString(value: string): string {
  return formatMicroUsd(parseUsdToMicro(value));
}

function parseUsdToMicro(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new Error(`Invalid USD value: ${value}`);
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 1_000_000n + BigInt(`${fraction}000000`.slice(0, 6));
}

function formatMicroUsd(value: bigint): string {
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${whole}.${fraction}`;
}
