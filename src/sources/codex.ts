import { normalizeAgentModelForUsage, resolvePricing, type UsageModelNormalization } from "../pricing.js";
import { toUtcHalfHourStart } from "../time.js";
import type { UsageEvent, UsageTotals } from "../types.js";

interface ParseOptions {
  sourcePath: string;
  serviceTier?: "standard" | "fast" | "priority" | "flex";
  compactionHistory?: Map<string, string>;
  useReplayPlan?: boolean;
}

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
  snapshot(): unknown;
}

interface CumulativeUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

type CodexServiceTier = "standard" | "fast" | "flex" | "ultrafast";

interface ParsedCodexUsageEvent extends UsageEvent {
  codexServiceTier?: CodexServiceTier;
}

export function parseCodexJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  const parser = createCodexJsonlParser(options);
  for (const line of jsonl.split(/\r?\n/)) {
    parser.pushLine(line);
  }
  return parser.finish();
}

export interface CodexCheckpoint {
  events: ParsedCodexUsageEvent[]; seenModels: Array<[string, UsageModelNormalization]>;
  sessionId: string | null; currentModel: UsageModelNormalization; currentServiceTier: CodexServiceTier | null;
  previousTotal: CumulativeUsage | null; suppressInheritedSubagentReplay: boolean;
  compacted: string[]; emitted: string[];
  pending: Array<[string, { event: ParsedCodexUsageEvent; threadUsage: CumulativeUsage | null }]>;
  latestResponse: string | null; compactions: Array<[string, string]>;
  replayFirstUsage?: string;
  session: { id: string; parent?: string; forkTime?: string; rewrittenBurst?: string | null } | null;
}
export function createCodexJsonlParser(options: ParseOptions, saved?: unknown): JsonlUsageParser {
  const checkpoint = saved as CodexCheckpoint | undefined;
  const events: ParsedCodexUsageEvent[] = checkpoint?.events || [];
  const seenModels = new Map<string, UsageModelNormalization>(checkpoint?.seenModels);
  let sessionId: string | null = checkpoint?.sessionId || null;
  let currentModel: UsageModelNormalization = checkpoint?.currentModel || { model: "unknown", originalModel: "unknown" };
  let currentServiceTier: CodexServiceTier | null = checkpoint?.currentServiceTier || null;
  let previousTotal: CumulativeUsage | null = checkpoint?.previousTotal || null;
  // Codex subagent rollouts begin with a replay of their parent's history.
  let suppressInheritedSubagentReplay = checkpoint?.suppressInheritedSubagentReplay || false;
  const compacted = new Set<string>(checkpoint?.compacted);
  const emitted = new Set<string>(checkpoint?.emitted);
  const pending = new Map<string, { event: ParsedCodexUsageEvent; threadUsage: CumulativeUsage | null }>(checkpoint?.pending);
  let latestResponse: string | null = checkpoint?.latestResponse || null;
  let session: CodexCheckpoint["session"] = checkpoint?.session || null;
  let replayFirstUsage = checkpoint?.replayFirstUsage;
  if (checkpoint) for (const [id, time] of checkpoint.compactions) options.compactionHistory?.set(id, time);

  function setCurrentModel(model: string): void {
    const normalized = normalizeAgentModelForUsage("codex", model);
    currentModel = normalized;
    if (normalized.model !== "unknown") seenModels.set(normalized.model, normalized);
  }

  return {
    snapshot: (): CodexCheckpoint => ({ events, seenModels: [...seenModels], sessionId, currentModel, currentServiceTier, previousTotal,
      suppressInheritedSubagentReplay, compacted: [...compacted], emitted: [...emitted], pending: [...pending], latestResponse,
      compactions: [...(options.compactionHistory || [])], session, replayFirstUsage }),
    pushLine(line: string): void {
      if (!line.trim()) return;
      if (
        !line.includes("token_count") &&
        !line.includes("turn_context") &&
        !line.includes("session_meta") &&
        !line.includes("inter_agent_communication_metadata") &&
        !line.includes("thread_settings_applied") &&
        !line.includes("token_usage_record") &&
        !line.includes("compacted")
      ) {
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
      if (type === "session_meta" && payload) {
        const source = recordField(payload, "source");
        session = { id: stringField(payload, "id") || stringField(payload, "session_id") || options.sourcePath,
          parent: stringField(payload, "forked_from_id") || stringField(recordField(recordField(source, "subagent"), "thread_spawn"), "parent_thread_id") || undefined,
          forkTime: stringField(row, "timestamp") || undefined };
      }

      if (type === "compacted") {
        const id = stringField(payload, "compaction_response_id");
        if (!id) return;
        compacted.add(id);
        const request = pending.get(id);
        if (request && !emitted.has(id)) { events.push(request.event); emitted.add(id); pending.delete(id); }
        return;
      }
      if (type === "token_usage_record") {
        const id = stringField(payload, "response_id");
        const usage = recordField(payload, "usage");
        const timestamp = stringField(row, "timestamp");
        if (!id || !usage || !timestamp || emitted.has(id)) return;
        const bucketStart = toUtcHalfHourStart(timestamp);
        if (!bucketStart) return;
        const totals = normalizeUsage(usage);
        if (isZero(totals)) return;
        options.compactionHistory?.set(id, timestamp);
        const rawModel = modelFromContextPayload(payload || {});
        const model = rawModel ? normalizeAgentModelForUsage("codex", rawModel) : currentModel;
        const event: ParsedCodexUsageEvent = { agent: "codex", model: model.model,
          ...(model.pricingModel ? { pricingModel: model.pricingModel } : {}),
          ...codexPricingFields(model, effectiveServiceTier(currentServiceTier, options.serviceTier), currentServiceTier),
          messageId: id, sessionId, sourcePath: options.sourcePath, timestamp, bucketStart, ...totals };
        latestResponse = id;
        if (compacted.has(id)) { events.push(event); emitted.add(id); }
        else if (!pending.has(id)) pending.set(id, { event, threadUsage: recordField(payload, "thread_token_usage") ? normalizeUsage(recordField(payload, "thread_token_usage")!) : null });
        return;
      }

      if (type === "inter_agent_communication_metadata" && payload?.trigger_turn === true) {
        suppressInheritedSubagentReplay = false;
        return;
      }

      const settingsTier = codexServiceTierFromSettings(payload);
      if (settingsTier !== undefined) {
        currentServiceTier = settingsTier;
        return;
      }

      if ((type === "session_meta" || type === "turn_context") && payload) {
        const payloadSessionId =
          stringField(payload, "session_id") || stringField(payload, "sessionId") || stringField(payload, "id");
        if (payloadSessionId && !sessionId) {
          suppressInheritedSubagentReplay = !options.useReplayPlan && isSubagentSession(payload);
          sessionId = suppressInheritedSubagentReplay
            ? stringField(payload, "id") || payloadSessionId
            : payloadSessionId;
        }
        const model = modelFromContextPayload(payload);
        if (model) setCurrentModel(model);
        return;
      }

      const token = extractTokenCount(row);
      if (!token) return;
      const timestamp = stringField(row, "timestamp");
      if (!timestamp) return;

      const info = token.info;
      const model =
        stringField(info, "model") || stringField(info, "model_name") || stringField(token.payload, "model");
      if (model) setCurrentModel(model);

      const lastUsage = recordField(info, "last_token_usage");
      const totalUsage = recordField(info, "total_token_usage");
      // Probe raw snapshots before cumulative deduplication hides repeated replay rows.
      const probeUsage = lastUsage || totalUsage;
      if (session?.parent && session.rewrittenBurst === undefined && probeUsage && !isZero(normalizeUsage(probeUsage))) {
        if (replayFirstUsage === undefined) replayFirstUsage = timestamp;
        else {
          const first = Date.parse(replayFirstUsage), pause = Date.parse(timestamp) - first;
          const startsAtFork = !session.forkTime || Math.abs(first - Date.parse(session.forkTime)) <= 1000;
          session.rewrittenBurst = pause >= 0 && pause <= 1000 && startsAtFork ? replayFirstUsage : null;
        }
      }
      const delta = pickDelta(lastUsage, totalUsage, previousTotal);
      const request = latestResponse ? pending.get(latestResponse) : null;
      if (delta && request && (sameUsage(delta as CumulativeUsage, request.event)
        || (request.threadUsage && totalUsage && sameUsage(request.threadUsage, normalizeUsage(totalUsage))))) {
        pending.delete(latestResponse!); emitted.add(latestResponse!);
      }
      // Retain the cumulative baseline while suppressing inherited events so a
      // later total-only row can still be converted to the subagent's delta.
      if (totalUsage) previousTotal = normalizeUsage(totalUsage);
      if (suppressInheritedSubagentReplay) return;
      if (!delta || isZero(delta)) return;

      const bucketStart = toUtcHalfHourStart(timestamp);
      if (!bucketStart) return;
      const eventModel = codexModelForEvent(currentModel, timestamp);

      events.push({
        agent: "codex",
        model: eventModel.model,
        ...(eventModel.pricingModel ? { pricingModel: eventModel.pricingModel } : {}),
        ...codexPricingFields(eventModel, effectiveServiceTier(currentServiceTier, options.serviceTier), currentServiceTier),
        sessionId,
        sourcePath: options.sourcePath,
        timestamp,
        bucketStart,
        ...delta,
      });
    },

    finish(): UsageEvent[] {
      if (options.compactionHistory) for (const id of options.compactionHistory.keys()) if (!compacted.has(id)) options.compactionHistory.delete(id);
      if (seenModels.size === 1) {
        const [model] = [...seenModels.values()];
        return events.map((event) => {
          const { codexServiceTier, ...publicEvent } = event;
          return publicEvent.model === "unknown"
            ? stripUndefinedCostMultiplier({
                ...publicEvent,
                model: model.model,
                ...(model.pricingModel ? { pricingModel: model.pricingModel } : {}),
                ...codexPricingFields(model, codexServiceTier || "standard"),
              })
            : publicEvent;
        });
      }
      return events.map(({ codexServiceTier, ...event }) => event);
    },
  };
}

const CODEX_AUTO_REVIEW_FALLBACKS = [
  { releasedOn: "2026-07-30T00:00:00.000Z", model: "gpt-5.6-luna" },
  { releasedOn: "2026-03-05T00:00:00.000Z", model: "gpt-5.4" },
  { releasedOn: "2026-02-05T00:00:00.000Z", model: "gpt-5.3-codex" },
  { releasedOn: "2025-12-11T00:00:00.000Z", model: "gpt-5.2-codex" },
  { releasedOn: "2025-11-13T00:00:00.000Z", model: "gpt-5.1-codex" },
  { releasedOn: "2025-09-15T00:00:00.000Z", model: "gpt-5-codex" },
  { releasedOn: "2025-08-07T00:00:00.000Z", model: "gpt-5" },
] as const;

function codexModelForEvent(model: UsageModelNormalization, timestamp: string): UsageModelNormalization {
  if (model.model !== "codex-auto-review" && model.originalModel !== "codex-auto-review") return model;
  return {
    ...model,
    pricingModel: codexAutoReviewPricingModel(timestamp),
  };
}

function codexAutoReviewPricingModel(timestamp: string): string {
  const millis = Date.parse(timestamp);
  if (!Number.isFinite(millis)) return "gpt-5";
  for (const fallback of CODEX_AUTO_REVIEW_FALLBACKS) {
    if (millis >= Date.parse(fallback.releasedOn)) return fallback.model;
  }
  return CODEX_AUTO_REVIEW_FALLBACKS[CODEX_AUTO_REVIEW_FALLBACKS.length - 1].model;
}

function isSubagentSession(payload: Record<string, unknown>): boolean {
  return Boolean(recordField(recordField(payload, "source"), "subagent"));
}

function codexPricingFields(
  model: UsageModelNormalization,
  serviceTier: CodexServiceTier,
  recordedTier?: CodexServiceTier | null,
): { costMultiplier?: string; codexServiceTier?: CodexServiceTier; serviceTier?: CodexServiceTier; recordedServiceTier?: CodexServiceTier } {
  const recorded = recordedTier ? { recordedServiceTier: recordedTier } : {};
  if (serviceTier !== "fast") return { codexServiceTier: serviceTier, serviceTier, ...recorded };
  const multiplier = codexFastMultiplier(model);
  return {
    codexServiceTier: serviceTier,
    serviceTier,
    ...recorded,
    ...(multiplier ? { costMultiplier: multiplier } : {}),
  };
}

function stripUndefinedCostMultiplier(event: UsageEvent): UsageEvent {
  if (event.costMultiplier !== undefined) return event;
  const { costMultiplier, ...withoutMultiplier } = event;
  return withoutMultiplier;
}

function effectiveServiceTier(
  recordedTier: CodexServiceTier | null,
  fallbackTier: ParseOptions["serviceTier"],
): CodexServiceTier {
  if (recordedTier) return recordedTier;
  if (fallbackTier === "flex") return "flex";
  return fallbackTier === "fast" || fallbackTier === "priority" ? "fast" : "standard";
}

function codexFastMultiplier(model: UsageModelNormalization): string | null {
  const pricingModel = model.pricingModel || model.originalModel || model.model;
  return resolvePricing(pricingModel)?.fastMultiplier || resolvePricing(model.model)?.fastMultiplier || null;
}

function codexServiceTierFromSettings(payload: Record<string, unknown> | null): CodexServiceTier | null | undefined {
  if (stringField(payload, "type") !== "thread_settings_applied") return undefined;
  const settings = recordField(payload, "thread_settings");
  if (!settings || !("service_tier" in settings)) return undefined;
  const value = stringField(settings, "service_tier");
  if (value === "default" || value === "standard") return "standard";
  if (value === "fast" || value === "priority") return "fast";
  if (value === "flex") return "flex";
  if (value === "ultrafast") return "ultrafast";
  return null;
}

function modelFromContextPayload(payload: Record<string, unknown>): string | null {
  return (
    stringField(payload, "model") ||
    stringField(recordField(payload, "info"), "model") ||
    stringField(recordField(recordField(payload, "collaboration_mode"), "settings"), "model")
  );
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
  const cacheCreationTokens = Math.min(
    inputTokens - cachedInputTokens,
    nonNegativeInt(value.cache_write_input_tokens ?? value.cache_creation_tokens ?? value.cache_creation_input_tokens),
  );
  const totalTokens = nonNegativeInt(value.total_tokens) || inputTokens + outputTokens;

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
