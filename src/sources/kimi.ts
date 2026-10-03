import path from "node:path";

import { normalizeAgentModelForUsage, type UsageModelNormalization } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import { applyTotalTokenFallback, isZeroUsage, nonNegativeInt } from "../token-totals.js";
import type { UsageEvent, UsageTotals } from "../types.js";

const DEFAULT_MODEL = "kimi-for-coding";
const KIMI_FOR_CODING_K2_6_CUTOFF_MS = 1_776_698_890_072;

interface ParseOptions {
  sourcePath: string;
  model?: string | null;
  fallbackTimestamp?: string;
}

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
}

export function parseKimiWireJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createKimiWireJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) parser.pushLine(line);
  return parser.finish();
}

export function createKimiWireJsonlParser(options: ParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];
  const model = normalizeKimiModel(options.model);
  const sessionId = sessionIdFromWirePath(options.sourcePath);

  return {
    pushLine(line: string): void {
      if (!line.includes("usage.record") && (!line.includes("StatusUpdate") || !line.includes("token_usage"))) return;
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed)) return;
      const modern = parsed.type === "usage.record";
      if (modern && parsed.usageScope !== "turn") return;
      const message = recordField(parsed, "message");
      if (!modern && stringField(message, "type") !== "StatusUpdate") return;
      const payload = recordField(message, "payload");
      const tokenUsage = modern ? recordField(parsed, "usage") : recordField(payload, "token_usage");
      if (!tokenUsage) return;

      const timestamp = modern
        ? (Number.isFinite(Number(parsed.time)) && parsed.time !== undefined ? new Date(Number(parsed.time)).toISOString() : options.fallbackTimestamp)
        : timestampFromSeconds(parsed.timestamp);
      if (!timestamp) return;
      const bucketStart = toUtcHalfHourStart(timestamp);
      if (!bucketStart) return;

      const totals = applyTotalTokenFallback(
        {
          inputTokens: nonNegativeInt(modern ? tokenUsage.inputOther : tokenUsage.input_other),
          cachedInputTokens: nonNegativeInt(modern ? tokenUsage.inputCacheRead : tokenUsage.input_cache_read),
          outputTokens: nonNegativeInt(tokenUsage.output),
          reasoningOutputTokens: 0,
          cacheCreationTokens: nonNegativeInt(modern ? tokenUsage.inputCacheCreation : tokenUsage.input_cache_creation),
          totalTokens: 0,
        },
        nonNegativeInt(tokenUsage.total),
      );
      if (isZeroUsage(totals)) return;

      const eventModel = modern ? normalizeKimiModel(stringField(parsed, "model")?.replace(/^kimi-code\//, "") || DEFAULT_MODEL) : model;
      events.push({
        ...(!modern && stringField(payload, "message_id") ? { messageId: stringField(payload, "message_id")! } : {}),
        agent: "kimi",
        model: eventModel.model,
        pricingModel: eventModel.pricingModel || kimiPricingModel(eventModel.originalModel, timestamp) || eventModel.model,
        sessionId,
        sourcePath: options.sourcePath,
        timestamp,
        bucketStart,
        ...totals,
      });
    },

    finish(): UsageEvent[] {
      return events;
    },
  };
}

function normalizeKimiModel(model: string | null | undefined): UsageModelNormalization {
  return normalizeAgentModelForUsage("kimi", model || DEFAULT_MODEL);
}

function kimiPricingModel(model: string, timestamp: string): string | undefined {
  if (model !== DEFAULT_MODEL) return model;
  const time = new Date(timestamp).getTime();
  return time < KIMI_FOR_CODING_K2_6_CUTOFF_MS ? "moonshot/kimi-k2.5" : "moonshot/kimi-k2.6";
}

function timestampFromSeconds(value: unknown): string | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return new Date(Math.trunc(seconds * 1000)).toISOString();
}

function sessionIdFromWirePath(filePath: string): string | null {
  const parts = filePath.split(path.sep);
  const sessions = parts.lastIndexOf("sessions");
  if (sessions >= 0 && parts[sessions + 2]) return parts[sessions + 2];
  const parent = path.basename(path.dirname(filePath));
  return parent && parent !== "." ? parent : null;
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
