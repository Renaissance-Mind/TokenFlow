import { normalizeAgentModel } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent, UsageTotals } from "../types.js";

interface ParseOptions {
  sourcePath: string;
}

export function parseGeminiSession(rawJson: string, options: ParseOptions): UsageEvent[] {
  const parsed = JSON.parse(rawJson) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) return [];

  const events: UsageEvent[] = [];
  let previousTotals: UsageTotals | null = null;
  let currentModel = "unknown";

  for (const message of parsed.messages) {
    if (!isRecord(message)) continue;
    const model = stringField(message, "model");
    if (model) currentModel = normalizeAgentModel("gemini", model);

    const timestamp = stringField(message, "timestamp");
    const bucketStart = timestamp ? toUtcHalfHourStart(timestamp) : null;
    const totals = normalizeGeminiTokens(recordField(message, "tokens"));
    if (!timestamp || !bucketStart || !totals) {
      previousTotals = totals || previousTotals;
      continue;
    }

    const delta = diffTotals(totals, previousTotals);
    previousTotals = totals;
    if (!delta || isZero(delta)) continue;

    events.push({
      agent: "gemini",
      model: currentModel,
      sessionId: stringField(message, "sessionId") || null,
      sourcePath: options.sourcePath,
      timestamp,
      bucketStart,
      ...delta,
    });
  }

  return events;
}

function normalizeGeminiTokens(tokens: Record<string, unknown> | null): UsageTotals | null {
  if (!tokens) return null;
  const inputTokens = nonNegativeInt(tokens.input);
  const cachedInputTokens = nonNegativeInt(tokens.cached);
  const outputTokens = nonNegativeInt(tokens.output) + nonNegativeInt(tokens.tool);
  const reasoningOutputTokens = nonNegativeInt(tokens.thoughts);
  const totalTokens =
    nonNegativeInt(tokens.total) || inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheCreationTokens: 0,
    totalTokens,
  };
}

function diffTotals(current: UsageTotals, previous: UsageTotals | null): UsageTotals | null {
  if (!previous) return current;
  if (current.totalTokens < previous.totalTokens) return current;
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - previous.cacheCreationTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
  };
}

function isZero(value: UsageTotals): boolean {
  return (
    value.inputTokens === 0 &&
    value.cachedInputTokens === 0 &&
    value.outputTokens === 0 &&
    value.reasoningOutputTokens === 0 &&
    value.cacheCreationTokens === 0 &&
    value.totalTokens === 0
  );
}

function nonNegativeInt(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordField(value: Record<string, unknown> | null | undefined, key: string): Record<string, unknown> | null {
  const field = value?.[key];
  return isRecord(field) ? field : null;
}

function stringField(value: Record<string, unknown> | null | undefined, key: string): string | null {
  const field = value?.[key];
  return typeof field === "string" && field.trim() ? field.trim() : null;
}
