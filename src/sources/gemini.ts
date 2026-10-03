import { normalizeAgentModelForUsage, type UsageModelNormalization } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent, UsageTotals } from "../types.js";
import path from "node:path";
import { makeUsageEvent, type JsonlUsageParser } from "./ccusage-common.js";

interface ParseOptions {
  sourcePath: string;
  fallbackTimestamp?: string;
}

export function parseGeminiSession(rawJson: string, options: ParseOptions): UsageEvent[] {
  const parsed = JSON.parse(rawJson) as unknown;
  if (!isRecord(parsed)) return [];
  if (!Array.isArray(parsed.messages) || parsed.messages.some((message) => isRecord(message) && message.type === "gemini")) {
    const parser = createGeminiJsonlParser(options);
    if (Array.isArray(parsed.messages)) for (const message of parsed.messages) {
      if (isRecord(message) && message.type === "gemini") parser.pushLine(JSON.stringify({ ...message, sessionId: parsed.sessionId,
        timestamp: message.timestamp || parsed.startTime || parsed.lastUpdated || options.fallbackTimestamp }));
    } else parser.pushLine(rawJson);
    return parser.finish();
  }

  const events: UsageEvent[] = [];
  let previousTotals: UsageTotals | null = null;
  let currentModel: UsageModelNormalization = { model: "unknown", originalModel: "unknown" };

  for (const message of parsed.messages) {
    if (!isRecord(message)) continue;
    const model = stringField(message, "model");
    if (model) currentModel = normalizeAgentModelForUsage("gemini", model);

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
      model: currentModel.model,
      ...(currentModel.pricingModel ? { pricingModel: currentModel.pricingModel } : {}),
      sessionId: stringField(message, "sessionId") || null,
      sourcePath: options.sourcePath,
      timestamp,
      bucketStart,
      ...delta,
    });
  }

  return events;
}

export function createGeminiJsonlParser(options: ParseOptions): JsonlUsageParser {
  const entries = new Map<string, UsageEvent>();
  let sessionId = path.basename(options.sourcePath, path.extname(options.sourcePath));
  let currentModel = "unknown";
  let serial = 0;
  return {
    pushLine(line) {
      const row = JSON.parse(line) as Record<string, unknown>;
      sessionId = stringField(row, "sessionId") || stringField(row, "session_id") || sessionId;
      currentModel = stringField(row, "model") || currentModel;
      const stats = recordField(row, "stats") || recordField(recordField(row, "result"), "stats");
      const models = recordField(stats, "models");
      const records: Array<[string, Record<string, unknown>, boolean]> = row.type === "gemini"
        ? [[currentModel, recordField(row, "tokens") || {}, true]]
        : models ? Object.entries(models).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
          .map(([model, value]) => [model, recordField(value, "tokens") || {}, false])
          : stats ? [[currentModel, stats, false]] : [];
      for (const [model, tokens, direct] of records) {
        const value = (...keys: string[]) => nonNegativeInt(keys.map((key) => tokens[key]).find((value) => typeof value === "number"));
        const input = value("input", "prompt", "input_tokens", "prompt_tokens");
        const output = value("output", "candidates", "output_tokens", "candidates_tokens");
        const cached = value("cached", "cached_tokens");
        const reasoning = value("thoughts", "reasoning", "thoughts_tokens", "reasoning_tokens");
        const tool = value("tool", "tool_tokens");
        const total = value("total", "total_tokens");
        const inclusive = !direct || (cached > 0 && total === input + output + reasoning + tool);
        const event = makeUsageEvent({ agent: "gemini", model, sessionId, sourcePath: options.sourcePath,
          timestamp: stringField(row, "timestamp") || stringField(row, "created_at") || options.fallbackTimestamp || null,
          inputTokens: (inclusive ? Math.max(input, cached) : input + cached) + tool,
          cachedInputTokens: cached, outputTokens: output, reasoningOutputTokens: reasoning,
          totalTokens: total });
        if (event) {
          const accounted = event.inputTokens + output + reasoning;
          event.totalTokens = Math.max(total, accounted);
          event.extraTotalTokens = Math.max(0, total - accounted);
          event.messageId = stringField(row, "id") || undefined;
          entries.set(event.messageId ? `${sessionId}|${event.messageId}` : `row-${serial++}`, event);
        }
      }
    },
    finish: () => [...entries.values()],
  };
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
