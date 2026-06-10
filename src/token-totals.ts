import type { UsageTotals } from "./types.js";

export function totalUsageTokens(totals: UsageTotals): number {
  return (
    totals.inputTokens +
    totals.cachedInputTokens +
    totals.outputTokens +
    totals.reasoningOutputTokens +
    totals.cacheCreationTokens +
    (totals.extraTotalTokens || 0)
  );
}

export function applyTotalTokenFallback(totals: UsageTotals, totalTokens: number): UsageTotals {
  if (totalTokens <= 0) {
    return {
      ...totals,
      extraTotalTokens: totals.extraTotalTokens || 0,
      totalTokens: totalUsageTokens(totals),
    };
  }

  const knownTokens = totalUsageTokens(totals);
  const missingTokens = Math.max(0, totalTokens - knownTokens);
  if (missingTokens === 0) return { ...totals, extraTotalTokens: totals.extraTotalTokens || 0, totalTokens };
  if (totals.outputTokens === 0) {
    return {
      ...totals,
      outputTokens: missingTokens,
      extraTotalTokens: totals.extraTotalTokens || 0,
      totalTokens,
    };
  }
  return {
    ...totals,
    extraTotalTokens: (totals.extraTotalTokens || 0) + missingTokens,
    totalTokens,
  };
}

export function isZeroUsage(totals: UsageTotals): boolean {
  return totalUsageTokens(totals) === 0;
}

export function nonNegativeInt(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}
