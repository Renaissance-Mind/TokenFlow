import { normalizeAgentModelForUsage } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent } from "../types.js";

export interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created?: number;
  data: string;
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
  if (totalTokens === 0) return null;

  const timestampMs =
    typeof time?.created === "number" ? time.created : typeof row.time_created === "number" ? row.time_created : 0;
  const timestamp = new Date(timestampMs).toISOString();
  const bucketStart = toUtcHalfHourStart(timestamp);
  if (!bucketStart) return null;
  const model = normalizeAgentModelForUsage(
    "opencode",
    stringField(value.modelID) || stringField(value.model) || "unknown",
  );

  return {
    agent: "opencode",
    model: model.model,
    ...(model.pricingModel ? { pricingModel: model.pricingModel } : {}),
    sessionId: row.session_id || stringField(value.sessionID) || null,
    sourcePath,
    timestamp,
    bucketStart,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheCreationTokens,
    totalTokens,
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
