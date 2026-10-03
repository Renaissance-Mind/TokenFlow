import { normalizeAgentModelForUsage } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent } from "../types.js";
import { applyTotalTokenFallback } from "../token-totals.js";
import { optionalDecimalString } from "./ccusage-common.js";

export interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created?: number;
  data: string;
  aggregate?: boolean;
}

export function parseOpenCodeMessageRow(row: OpenCodeMessageRow, sourcePath = "opencode.db"): UsageEvent | null {
  const value = JSON.parse(row.data) as Record<string, unknown>;

  const time = objectField(value, "time");
  const tokens = objectField(value, "tokens");
  if (!tokens) return null;

  const inputTokens = intField(tokens.input);
  const outputTokens = intField(tokens.output);
  const reasoningOutputTokens = intField(tokens.reasoning);
  const cache = objectField(tokens, "cache");
  const cachedInputTokens = intField(cache?.read);
  const cacheCreationTokens = intField(cache?.write);
  const totalTokens =
    inputTokens + outputTokens + reasoningOutputTokens + cachedInputTokens + cacheCreationTokens;
  if (totalTokens === 0 && !(row.aggregate && Number(value.cost) > 0)) return null;

  const timestampMs =
    typeof time?.created === "number" ? time.created : typeof row.time_created === "number" ? row.time_created : 0;
  const timestamp = new Date(timestampMs).toISOString();
  const bucketStart = toUtcHalfHourStart(timestamp);
  if (!bucketStart) return null;
  const modelRef = objectField(value, "model");
  const rawModel = stringField(modelRef?.id) || stringField(modelRef?.modelID) || stringField(value.modelID) || stringField(value.model) || "unknown";
  const provider = stringField(modelRef?.providerID) || stringField(value.providerID);
  const model = normalizeAgentModelForUsage(
    "opencode",
    provider ? `${provider}/${rawModel}` : rawModel,
  );

  return {
    agent: "opencode",
    model: model.model,
    ...(model.pricingModel ? { pricingModel: model.pricingModel } : {}),
    sessionId: row.session_id || stringField(value.sessionID) || null,
    sourcePath,
    timestamp,
    bucketStart,
    ...applyTotalTokenFallback({ inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens, cacheCreationTokens, totalTokens }, intField(tokens.total)),
    ...(Number(value.cost) > 0 ? { recordedCostUsd: optionalDecimalString(value.cost) } : {}),
  };
}

function objectField(value: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const field = value[key];
  if (!field || typeof field !== "object" || Array.isArray(field)) return null;
  return field as Record<string, unknown>;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function intField(value: unknown): number {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.floor(number);
}
