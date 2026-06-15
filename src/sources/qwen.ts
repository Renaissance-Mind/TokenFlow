import path from "node:path";

import { normalizeAgentModelForUsage } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import { applyTotalTokenFallback, isZeroUsage, nonNegativeInt } from "../token-totals.js";
import type { UsageEvent } from "../types.js";

interface ParseOptions {
  sourcePath: string;
}

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
}

export function parseQwenChatJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createQwenChatJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) parser.pushLine(line);
  return parser.finish();
}

export function createQwenChatJsonlParser(options: ParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];

  return {
    pushLine(line: string): void {
      if (!line.includes("usageMetadata")) return;
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed) || stringField(parsed, "type") !== "assistant") return;
      const usage = recordField(parsed, "usageMetadata");
      if (!usage) return;

      const timestamp = stringField(parsed, "timestamp");
      const bucketStart = timestamp ? toUtcHalfHourStart(timestamp) : null;
      if (!timestamp || !bucketStart) return;

      const model = normalizeAgentModelForUsage("qwen", stringField(parsed, "model") || "unknown");
      const totals = applyTotalTokenFallback(
        {
          inputTokens: nonNegativeInt(usage.promptTokenCount),
          cachedInputTokens: nonNegativeInt(usage.cachedContentTokenCount),
          outputTokens: nonNegativeInt(usage.candidatesTokenCount),
          reasoningOutputTokens: nonNegativeInt(usage.thoughtsTokenCount),
          cacheCreationTokens: 0,
          totalTokens: 0,
        },
        nonNegativeInt(usage.totalTokenCount),
      );
      if (isZeroUsage(totals)) return;

      events.push({
        agent: "qwen",
        model: model.model,
        pricingModel: model.pricingModel || model.model,
        sessionId: stringField(parsed, "sessionId") || sessionIdFromChatPath(options.sourcePath),
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

function sessionIdFromChatPath(filePath: string): string | null {
  const stem = path.basename(filePath, path.extname(filePath));
  return stem && stem !== "." ? stem : null;
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
