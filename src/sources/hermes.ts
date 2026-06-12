import {
  makeUsageEvent,
  numberToNonNegativeInt,
  optionalDecimalString,
  timestampFromValue,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

export interface HermesSessionRow {
  id: string;
  model: string;
  billing_provider?: string | null;
  started_at: number | string;
  message_count?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
}

export function parseHermesSessionRow(row: HermesSessionRow, sourcePath = "state.db"): UsageEvent | null {
  const model = row.model?.trim();
  if (!row.id || !model) return null;

  const recordedCostUsd = optionalDecimalString(firstPositive(row.actual_cost_usd, row.estimated_cost_usd));
  const inputTokens = numberToNonNegativeInt(row.input_tokens);
  const outputTokens = numberToNonNegativeInt(row.output_tokens);
  const cachedInputTokens = numberToNonNegativeInt(row.cache_read_tokens);
  const cacheCreationTokens = numberToNonNegativeInt(row.cache_write_tokens);
  const reasoningOutputTokens = numberToNonNegativeInt(row.reasoning_tokens);
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    cachedInputTokens === 0 &&
    cacheCreationTokens === 0 &&
    reasoningOutputTokens === 0 &&
    !recordedCostUsd
  ) {
    return null;
  }

  return makeUsageEvent({
    agent: "hermes",
    model,
    sessionId: row.id,
    sourcePath,
    timestamp: timestampFromValue(row.started_at),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationTokens,
    reasoningOutputTokens,
    recordedCostUsd,
  });
}

function firstPositive(...values: Array<number | null | undefined>): number | undefined {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return undefined;
}
