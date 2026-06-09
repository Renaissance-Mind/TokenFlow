import { normalizeAgentModel } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent, UsageTotals } from "../types.js";

interface ParseOptions {
  sourcePath: string;
}

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
}

export function parseClaudeJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createClaudeJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) {
    parser.pushLine(line);
  }
  return parser.finish();
}

export function createClaudeJsonlParser(options: ParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];
  const seen = new Set<string>();

  return {
    pushLine(line: string): void {
      if (!line.trim() || !line.includes('"usage"')) return;

      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(row)) return;

      const message = recordField(row, "message");
      const usage = recordField(message, "usage") || recordField(row, "usage");
      if (!usage) return;

      const dedupeId = stringField(message, "id") || stringField(row, "requestId");
      if (dedupeId && seen.has(dedupeId)) return;

      const timestamp = stringField(row, "timestamp");
      const bucketStart = timestamp ? toUtcHalfHourStart(timestamp) : null;
      if (!timestamp || !bucketStart) return;

      const totals = normalizeClaudeUsage(usage);
      if (isZero(totals)) return;

      if (dedupeId) seen.add(dedupeId);
      events.push({
        agent: "claude",
        model: normalizeAgentModel("claude", stringField(message, "model") || stringField(row, "model")),
        sessionId: stringField(row, "sessionId") || stringField(row, "session_id"),
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

function normalizeClaudeUsage(usage: Record<string, unknown>): UsageTotals {
  const inputTokens = nonNegativeInt(usage.input_tokens) + nonNegativeInt(usage.cache_creation_input_tokens);
  const cachedInputTokens = nonNegativeInt(usage.cache_read_input_tokens);
  const outputTokens = nonNegativeInt(usage.output_tokens);
  const totalTokens =
    nonNegativeInt(usage.total_tokens) || inputTokens + cachedInputTokens + outputTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
    cacheCreationTokens: nonNegativeInt(usage.cache_creation_input_tokens),
    totalTokens,
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
