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

interface CumulativeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export function parseCodexJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createCodexJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) {
    parser.pushLine(line);
  }
  return parser.finish();
}

export function createCodexJsonlParser(options: ParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];
  let sessionId: string | null = null;
  let currentModel = "unknown";
  let previousTotal: CumulativeUsage | null = null;

  return {
    pushLine(line: string): void {
      if (!line.trim()) return;
      if (!line.includes("token_count") && !line.includes("turn_context") && !line.includes("session_meta")) {
        return;
      }

      let row: unknown;
      try {
        row = JSON.parse(line);
      } catch {
        return;
      }

      if (!isRecord(row)) return;
      const type = stringField(row, "type");
      const payload = recordField(row, "payload");

      if ((type === "session_meta" || type === "turn_context") && payload) {
        const payloadSessionId =
          stringField(payload, "session_id") || stringField(payload, "sessionId") || stringField(payload, "id");
        if (payloadSessionId && !sessionId) sessionId = payloadSessionId;
        const model = stringField(payload, "model") || stringField(recordField(payload, "info"), "model");
        if (model) currentModel = normalizeAgentModel("codex", model);
        return;
      }

      const token = extractTokenCount(row);
      if (!token) return;
      const timestamp = stringField(row, "timestamp");
      if (!timestamp) return;

      const info = token.info;
      const model =
        stringField(info, "model") || stringField(info, "model_name") || stringField(token.payload, "model");
      if (model) currentModel = normalizeAgentModel("codex", model);

      const lastUsage = recordField(info, "last_token_usage");
      const totalUsage = recordField(info, "total_token_usage");
      const delta = pickDelta(lastUsage, totalUsage, previousTotal);
      if (totalUsage) previousTotal = normalizeUsage(totalUsage);
      if (!delta || isZero(delta)) return;

      const bucketStart = toUtcHalfHourStart(timestamp);
      if (!bucketStart) return;

      events.push({
        agent: "codex",
        model: currentModel,
        sessionId,
        sourcePath: options.sourcePath,
        timestamp,
        bucketStart,
        ...delta,
      });
    },

    finish(): UsageEvent[] {
      return events;
    },
  };
}

function extractTokenCount(row: Record<string, unknown>) {
  const payload = recordField(row, "payload");
  if (!payload) return null;
  if (stringField(payload, "type") === "token_count") return { payload, info: recordField(payload, "info") || {} };
  const msg = recordField(payload, "msg");
  if (msg && stringField(msg, "type") === "token_count") return { payload: msg, info: recordField(msg, "info") || {} };
  return null;
}

function pickDelta(
  lastUsage: Record<string, unknown> | null,
  totalUsage: Record<string, unknown> | null,
  previousTotal: CumulativeUsage | null,
): UsageTotals | null {
  if (totalUsage && previousTotal && sameUsage(normalizeUsage(totalUsage), previousTotal)) return null;
  if (lastUsage) return normalizeUsage(lastUsage);
  if (totalUsage && previousTotal) return diffUsage(normalizeUsage(totalUsage), previousTotal);
  if (totalUsage) return normalizeUsage(totalUsage);
  return null;
}

function normalizeUsage(value: Record<string, unknown>): CumulativeUsage {
  const inputTokens = nonNegativeInt(value.input_tokens);
  const cachedInputTokens = Math.min(
    inputTokens,
    nonNegativeInt(value.cached_input_tokens ?? value.cache_read_input_tokens),
  );
  const outputTokens = nonNegativeInt(value.output_tokens);
  const reasoningOutputTokens = nonNegativeInt(value.reasoning_output_tokens);
  const cacheCreationTokens = nonNegativeInt(value.cache_creation_tokens ?? value.cache_creation_input_tokens);
  const totalTokens =
    nonNegativeInt(value.total_tokens) ||
    inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens + cacheCreationTokens;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    cacheCreationTokens,
    totalTokens,
  };
}

function diffUsage(current: CumulativeUsage, previous: CumulativeUsage): UsageTotals | null {
  if (current.totalTokens < previous.totalTokens) return current;
  const delta = {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - previous.cachedInputTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - previous.reasoningOutputTokens),
    cacheCreationTokens: Math.max(0, current.cacheCreationTokens - previous.cacheCreationTokens),
    totalTokens: Math.max(0, current.totalTokens - previous.totalTokens),
  };
  return isZero(delta) ? null : delta;
}

function sameUsage(a: CumulativeUsage, b: CumulativeUsage): boolean {
  return (
    a.inputTokens === b.inputTokens &&
    a.cachedInputTokens === b.cachedInputTokens &&
    a.outputTokens === b.outputTokens &&
    a.reasoningOutputTokens === b.reasoningOutputTokens &&
    a.cacheCreationTokens === b.cacheCreationTokens &&
    a.totalTokens === b.totalTokens
  );
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
