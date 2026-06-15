import { normalizeAgentModelForUsage } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import { applyTotalTokenFallback, isZeroUsage, nonNegativeInt } from "../token-totals.js";
import type { AgentSource, UsageEvent, UsageTotals } from "../types.js";

export interface ParseOptions {
  sourcePath: string;
}

export interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
}

export interface UsageEventParts {
  agent: AgentSource;
  model: string | null | undefined;
  sessionId: string | null;
  sourcePath: string;
  timestamp: string | null;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  cacheCreationTokens?: number;
  extraTotalTokens?: number;
  totalTokens?: number;
  recordedCostUsd?: string;
}

export function parseJsonlWithParser(jsonl: string, parser: JsonlUsageParser): UsageEvent[] {
  for (const line of jsonl.split(/\r?\n/)) parser.pushLine(line);
  return parser.finish();
}

export function makeUsageEvent(parts: UsageEventParts): UsageEvent | null {
  if (!parts.timestamp) return null;
  const bucketStart = toUtcHalfHourStart(parts.timestamp);
  if (!bucketStart) return null;

  const totals = applyTotalTokenFallback(
    {
      inputTokens: parts.inputTokens || 0,
      cachedInputTokens: parts.cachedInputTokens || 0,
      outputTokens: parts.outputTokens || 0,
      reasoningOutputTokens: parts.reasoningOutputTokens || 0,
      cacheCreationTokens: parts.cacheCreationTokens || 0,
      extraTotalTokens: parts.extraTotalTokens || 0,
      totalTokens: 0,
    },
    parts.totalTokens || 0,
  );
  if (isZeroUsage(totals)) return null;

  const normalizedModel = normalizeAgentModelForUsage(parts.agent, parts.model || "unknown");

  return {
    agent: parts.agent,
    model: normalizedModel.model,
    ...(normalizedModel.pricingModel ? { pricingModel: normalizedModel.pricingModel } : {}),
    sessionId: parts.sessionId,
    sourcePath: parts.sourcePath,
    timestamp: parts.timestamp,
    bucketStart,
    ...totals,
    ...(parts.recordedCostUsd ? { recordedCostUsd: parts.recordedCostUsd } : {}),
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function recordField(value: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const field = value?.[key];
  return isRecord(field) ? field : null;
}

export function arrayField(value: Record<string, unknown> | null | undefined, key: string): unknown[] | null {
  const field = value?.[key];
  return Array.isArray(field) ? field : null;
}

export function stringField(value: Record<string, unknown> | null | undefined, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}

export function positiveNumberField(value: Record<string, unknown> | null | undefined, key: string): number {
  const number = Number(value?.[key]);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function optionalDecimalString(value: unknown): string | undefined {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return undefined;
  return String(number);
}

export function timestampFromValue(value: unknown): string | null {
  if (typeof value === "number") return timestampFromNumber(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return timestampFromNumber(Number(trimmed));
    return timestampFromString(trimmed);
  }
  return null;
}

export function timestampFromString(value: string): string | null {
  let normalized = value.trim();
  const datetime = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?$/);
  if (datetime) normalized = `${datetime[1]}T${datetime[2]}${datetime[3] || ""}Z`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) normalized = `${normalized}T00:00:00Z`;

  const millis = Date.parse(normalized);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

export function timestampFromNumber(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const millis = value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  return new Date(millis).toISOString();
}

export function numberToNonNegativeInt(value: unknown): number {
  return nonNegativeInt(value);
}

export function baseTotalsFromRecord(record: Record<string, unknown> | null | undefined, keys: {
  input: string;
  output: string;
  cacheRead?: string;
  cacheCreation?: string;
  reasoning?: string;
  total?: string;
}): Pick<
  UsageTotals,
  "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningOutputTokens" | "cacheCreationTokens"
> & { totalTokens: number } {
  return {
    inputTokens: numberToNonNegativeInt(record?.[keys.input]),
    outputTokens: numberToNonNegativeInt(record?.[keys.output]),
    cachedInputTokens: numberToNonNegativeInt(keys.cacheRead ? record?.[keys.cacheRead] : 0),
    cacheCreationTokens: numberToNonNegativeInt(keys.cacheCreation ? record?.[keys.cacheCreation] : 0),
    reasoningOutputTokens: numberToNonNegativeInt(keys.reasoning ? record?.[keys.reasoning] : 0),
    totalTokens: numberToNonNegativeInt(keys.total ? record?.[keys.total] : 0),
  };
}
