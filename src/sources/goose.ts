import {
  isRecord,
  makeUsageEvent,
  numberToNonNegativeInt,
  stringField,
  timestampFromValue,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

export interface GooseSessionRow {
  id: string;
  model_config_json: string;
  provider_name?: string | null;
  created_at: string | number;
  total_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  accumulated_total_tokens?: number | null;
  accumulated_input_tokens?: number | null;
  accumulated_output_tokens?: number | null;
}

export function parseGooseSessionRow(row: GooseSessionRow, sourcePath = "sessions.db"): UsageEvent | null {
  const model = parseGooseModelConfig(row.model_config_json);
  if (!row.id || !model) return null;

  const inputTokens = positiveInt(row.accumulated_input_tokens) || positiveInt(row.input_tokens);
  const outputTokens = positiveInt(row.accumulated_output_tokens) || positiveInt(row.output_tokens);
  const totalTokens =
    positiveInt(row.accumulated_total_tokens) ||
    positiveInt(row.total_tokens) ||
    inputTokens + outputTokens;
  const reasoningOutputTokens = Math.max(0, totalTokens - inputTokens - outputTokens);

  return makeUsageEvent({
    agent: "goose",
    model,
    sessionId: row.id,
    sourcePath,
    timestamp: timestampFromValue(row.created_at),
    inputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens,
  });
}

function parseGooseModelConfig(raw: string): string | null {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) return null;
  return stringField(value, "model_name");
}

function positiveInt(value: unknown): number {
  const number = numberToNonNegativeInt(value);
  return number > 0 ? number : 0;
}
