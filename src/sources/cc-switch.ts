import { normalizeAgentModel, normalizeModelForPricing } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { AgentSource, PricingProfile, UsageEvent } from "../types.js";

export interface CcSwitchRequestLogRow {
  request_id: string;
  app_type: string;
  model: string;
  request_model: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  status_code: number;
  session_id: string | null;
  created_at: number;
}

export interface CcSwitchPricingRow {
  model_id: string;
  display_name: string;
  input_cost_per_million: string;
  output_cost_per_million: string;
  cache_read_cost_per_million: string;
  cache_creation_cost_per_million: string;
}

export function parseCcSwitchRequestLogRow(row: CcSwitchRequestLogRow, sourcePath: string): UsageEvent | null {
  if (row.status_code < 200 || row.status_code >= 400) return null;
  const agent = normalizeCcSwitchAgent(row.app_type);
  const inputTokens = intField(row.input_tokens);
  const cachedInputTokens = intField(row.cache_read_tokens);
  const outputTokens = intField(row.output_tokens);
  const cacheCreationTokens = intField(row.cache_creation_tokens);
  const totalTokens = inputTokens + cachedInputTokens + outputTokens + cacheCreationTokens;
  if (totalTokens === 0) return null;

  const timestamp = ccSwitchTimestamp(row.created_at);
  const bucketStart = toUtcHalfHourStart(timestamp);
  if (!bucketStart) return null;
  const model = normalizeAgentModel(agent, row.model || row.request_model || "unknown");

  return {
    agent,
    model,
    sessionId: row.session_id || row.request_id || null,
    sourcePath,
    timestamp,
    bucketStart,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
    cacheCreationTokens,
    totalTokens,
  };
}

export function parseCcSwitchPricingRow(row: CcSwitchPricingRow): PricingProfile {
  return {
    modelId: normalizeModelForPricing(row.model_id),
    displayName: row.display_name,
    inputUsdPerMillion: row.input_cost_per_million,
    outputUsdPerMillion: row.output_cost_per_million,
    cacheReadUsdPerMillion: row.cache_read_cost_per_million,
    cacheCreationUsdPerMillion: row.cache_creation_cost_per_million,
  };
}

function normalizeCcSwitchAgent(value: string): AgentSource {
  if (value === "codex" || value === "claude" || value === "gemini" || value === "opencode" || value === "kimi") {
    return value;
  }
  return "unknown";
}

function ccSwitchTimestamp(value: number): string {
  const numeric = Number(value || 0);
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
  return new Date(millis || Date.now()).toISOString();
}

function intField(value: unknown): number {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}
