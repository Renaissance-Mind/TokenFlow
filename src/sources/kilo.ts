import {
  isRecord,
  makeUsageEvent,
  optionalDecimalString,
  recordField,
  stringField,
  timestampFromValue,
  type ParseOptions,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

export interface KiloMessageRow {
  id: string;
  session_id: string;
  data: string;
}

export function parseKiloMessageRow(row: KiloMessageRow, sourcePath = "kilo.db"): UsageEvent | null {
  const value = JSON.parse(row.data) as unknown;
  if (!isRecord(value)) return null;
  if (stringField(value, "role") !== "assistant") return null;

  const tokens = recordField(value, "tokens");
  if (!tokens) return null;
  const cache = recordField(tokens, "cache");
  const sessionId = stringField(value, "session_id") || row.session_id || null;

  return makeUsageEvent({
    agent: "kilo",
    model: stringField(value, "modelID"),
    sessionId,
    sourcePath,
    timestamp: timestampFromValue(recordField(value, "time")?.created),
    inputTokens: token(tokens.input),
    outputTokens: token(tokens.output),
    reasoningOutputTokens: token(tokens.reasoning),
    cacheCreationTokens: token(cache?.write),
    cachedInputTokens: token(cache?.read),
    totalTokens: token(tokens.total),
    recordedCostUsd: optionalDecimalString(value.cost),
  });
}

function token(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.floor(numeric);
}

export type KiloParseOptions = ParseOptions;
