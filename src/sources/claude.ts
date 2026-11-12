import { normalizeAgentModelForUsage, type UsageModelNormalization } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent, UsageTotals } from "../types.js";
import { optionalDecimalString } from "./ccusage-common.js";

interface ParseOptions {
  sourcePath: string;
}

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
  snapshot(): unknown;
}

export function parseClaudeJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createClaudeJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) {
    parser.pushLine(line);
  }
  return parser.finish();
}

export function createClaudeJsonlParser(options: ParseOptions, saved?: unknown): JsonlUsageParser {
  const checkpoint = saved as { events: UsageEvent[]; seen?: string[] } | undefined;
  const events: UsageEvent[] = checkpoint?.events || [];
  const seen = new Map<string, number>(events.flatMap((event, index) => event.messageId ? [[event.messageId, index] as [string, number]] : []));

  return {
    snapshot: () => ({ events, seen: [...seen.keys()] }),
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

      const timestamp = stringField(row, "timestamp");
      const bucketStart = timestamp ? toUtcHalfHourStart(timestamp) : null;
      if (!timestamp || !bucketStart) return;
      const messageId = stringField(message, "id");
      const requestId = stringField(row, "requestId") || stringField(row, "request_id");
      const sessionId = stringField(row, "sessionId") || stringField(row, "session_id");
      const dedupeId = messageId || requestId ? JSON.stringify([
        messageId, requestId,
        ...(requestId ? [] : [sessionId || options.sourcePath, ...(/^(msg_|resp_)/.test(messageId || "") ? [] : [timestamp])]),
      ]) : null;

      const totals = normalizeClaudeUsage(usage);
      const recordedCostUsd = typeof row.costUSD === "number" ? optionalDecimalString(row.costUSD) : undefined;
      if (isZero(totals) && !(Number(recordedCostUsd) > 0)) return;

      const speed = speedField(usage, "speed");
      const model = normalizeClaudeModelForUsage(
        normalizeAgentModelForUsage("claude", stringField(message, "model") || stringField(row, "model")),
        speed,
      );
      const fastMultiplier = model.pricingModel ? claudeFastMultiplier(model.pricingModel) : null;
      const event: UsageEvent = {
        ...(dedupeId ? { messageId: dedupeId } : {}),
        agent: "claude",
        model: model.displayModel,
        ...(model.pricingModel ? { pricingModel: model.pricingModel } : {}),
        ...(fastMultiplier ? { costMultiplier: fastMultiplier } : {}),
        ...(speed ? { recordedServiceTier: speed } : {}),
        sessionId,
        ...(row.isSidechain === true ? { isSidechain: true } : {}),
        sourcePath: options.sourcePath,
        timestamp,
        bucketStart,
        ...totals,
        ...(recordedCostUsd !== undefined ? { recordedCostUsd } : {}),
      };
      const existing = dedupeId ? seen.get(dedupeId) : undefined;
      if (existing !== undefined) events[existing] = mergeClaudeUsageCopies(events[existing], event);
      else {
        if (dedupeId) seen.set(dedupeId, events.length);
        events.push(event);
      }
    },

    finish(): UsageEvent[] {
      return events;
    },
  };
}

export function mergeClaudeUsageCopies(existing: UsageEvent, candidate: UsageEvent): UsageEvent {
  const aliases = new Set([existing, candidate].flatMap(event => event.isSidechain ? [] : [...(event.claudeSessionAliases || []), ...(event.sessionId ? [event.sessionId] : [])]));
  const speedRank = (event: UsageEvent) => event.recordedServiceTier === "fast" || event.model.endsWith("-fast") ? 2 : event.recordedServiceTier === "standard" ? 1 : 0;
  const detailRank = (event: UsageEvent) => Number(event.cacheCreation5mTokens !== undefined || event.cacheCreation1hTokens !== undefined);
  const replace = existing.isSidechain !== candidate.isSidechain
    ? !!existing.isSidechain
    : candidate.totalTokens !== existing.totalTokens ? candidate.totalTokens > existing.totalTokens
    : speedRank(candidate) !== speedRank(existing) ? speedRank(candidate) > speedRank(existing)
    : detailRank(candidate) > detailRank(existing);
  return { ...(replace ? candidate : existing), ...(aliases.size ? { claudeSessionAliases: [...aliases] } : {}) };
}

function normalizeClaudeModelForUsage(
  model: UsageModelNormalization,
  speed: "standard" | "fast" | null,
): { displayModel: string; pricingModel?: string } {
  const fastBaseDisplayModel = stripFastSuffix(model.model);
  const fastBaseOriginalModel = stripFastSuffix(model.pricingModel || model.originalModel);
  if (speed === "fast" || fastBaseDisplayModel || fastBaseOriginalModel) {
    const displayModel = fastBaseDisplayModel || model.model;
    const pricingModel = fastBaseOriginalModel || model.pricingModel || model.originalModel || displayModel;
    return { displayModel: `${displayModel}-fast`, pricingModel };
  }
  return {
    displayModel: model.model,
    ...(model.pricingModel ? { pricingModel: model.pricingModel } : {}),
  };
}

function claudeFastMultiplier(model: string): string | null {
  if (model === "claude-opus-4-6" || model === "claude-opus-4-7") return "6";
  if (model === "claude-opus-4-8") return "2";
  return null;
}

function stripFastSuffix(model: string): string | null {
  return model.endsWith("-fast") ? model.slice(0, -"-fast".length) : null;
}

function normalizeClaudeUsage(usage: Record<string, unknown>): UsageTotals {
  const inputTokens = nonNegativeInt(usage.input_tokens);
  const creation = recordField(usage, "cache_creation");
  const created5m = nonNegativeInt(creation?.ephemeral_5m_input_tokens), created1h = nonNegativeInt(creation?.ephemeral_1h_input_tokens);
  const created = nonNegativeInt(usage.cache_creation_input_tokens) || created5m + created1h;
  const cachedInputTokens = nonNegativeInt(usage.cache_read_input_tokens);
  const outputTokens = nonNegativeInt(usage.output_tokens);
  const totalTokens =
    nonNegativeInt(usage.total_tokens) || inputTokens + cachedInputTokens + outputTokens + created;

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens: 0,
    cacheCreationTokens: created,
    ...(creation ? { cacheCreation5mTokens: created5m, cacheCreation1hTokens: created1h } : {}),
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

function speedField(value: Record<string, unknown>, key: string): "standard" | "fast" | null {
  const field = value[key];
  return field === "standard" || field === "fast" ? field : null;
}
