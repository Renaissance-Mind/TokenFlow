import path from "node:path";

import { normalizeAgentModelForUsage } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import { isZeroUsage, nonNegativeInt } from "../token-totals.js";
import type { UsageEvent } from "../types.js";
import { reportSourceIssue } from "../source-input.js";

interface ParseOptions {
  sourcePath: string;
}

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
  snapshot(): unknown;
}

export function parseQwenChatJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createQwenChatJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) parser.pushLine(line);
  return parser.finish();
}

export function createQwenChatJsonlParser(options: ParseOptions, saved?: unknown): JsonlUsageParser {
  const checkpoint = saved as { events: UsageEvent[]; seen?: string[] } | undefined;
  const events: UsageEvent[] = checkpoint?.events || [];

  return {
    snapshot: () => ({ events }),
    pushLine(line: string): void {
      if (!line.includes("usageMetadata")) return;
      const parsed = JSON.parse(line) as unknown;
      if (!isRecord(parsed) || stringField(parsed, "type") !== "assistant") return;
      const usage = recordField(parsed, "usageMetadata");
      if (!usage) return;

      const timestamp = stringField(parsed, "timestamp");
      const bucketStart = timestamp ? toUtcHalfHourStart(timestamp) : null;
      if (!timestamp || !bucketStart) { reportSourceIssue(options.sourcePath, "invalid usage timestamp"); return; }

      const model = normalizeAgentModelForUsage("qwen", stringField(parsed, "model") || "unknown");
      const prompt = nonNegativeInt(usage.promptTokenCount);
      const reportedTotal = nonNegativeInt(usage.totalTokenCount);
      const cached = Math.min(prompt, nonNegativeInt(usage.cachedContentTokenCount));
      const thoughts = nonNegativeInt(usage.thoughtsTokenCount);
      const hasPrompt = usage.promptTokenCount != null;
      const hasCandidates = usage.candidatesTokenCount != null;
      const candidates = nonNegativeInt(usage.candidatesTokenCount);
      let output = hasCandidates ? candidates : hasPrompt ? Math.max(0, reportedTotal - prompt) : 0;
      if (hasCandidates && reportedTotal > prompt) output = Math.min(output, reportedTotal - prompt);
      const residual = Math.max(0, reportedTotal - prompt - output);
      const reasoning = !hasCandidates && reportedTotal === 0 ? thoughts : Math.min(thoughts, residual);
      const totals = {
        inputTokens: prompt - cached,
        cachedInputTokens: cached,
        outputTokens: output,
        reasoningOutputTokens: reasoning,
        extraTotalTokens: Math.max(0, residual - reasoning),
        cacheCreationTokens: 0,
        totalTokens: Math.max(reportedTotal, prompt + output + reasoning),
      };
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
