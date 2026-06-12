import path from "node:path";

import {
  baseTotalsFromRecord,
  makeUsageEvent,
  optionalDecimalString,
  parseJsonlWithParser,
  recordField,
  stringField,
  timestampFromValue,
  type JsonlUsageParser,
  type ParseOptions,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

export interface OpenClawParseOptions extends ParseOptions {
  fallbackTimestamp?: string | null;
}

export function parseOpenClawJsonl(jsonl: string, options: OpenClawParseOptions): UsageEvent[] {
  return parseJsonlWithParser(jsonl, createOpenClawJsonlParser(options));
}

export function createOpenClawJsonlParser(options: OpenClawParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];
  const sessionId = openClawSessionIdFromPath(options.sourcePath);
  let currentModel: string | null = null;

  return {
    pushLine(line: string): void {
      if (!line.includes("\"model_change\"") && !line.includes("\"model-snapshot\"") && !line.includes("\"usage\"")) {
        return;
      }
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;

      if (isModelChange(record)) {
        const source = recordField(record, "data") || record;
        currentModel = stringField(source, "modelId") || stringField(source, "model") || currentModel;
        return;
      }

      if (stringField(record, "type") !== "message") return;
      const message = recordField(record, "message");
      if (stringField(message, "role") !== "assistant") return;
      const usage = recordField(message, "usage");
      if (!usage) return;

      const totals = baseTotalsFromRecord(usage, {
        input: "input",
        output: "output",
        cacheRead: "cacheRead",
        cacheCreation: "cacheWrite",
        total: "totalTokens",
      });
      const cost = recordField(usage, "cost");
      const event = makeUsageEvent({
        agent: "openclaw",
        model: stringField(message, "modelId") || stringField(message, "model") || currentModel || "unknown",
        sessionId,
        sourcePath: options.sourcePath,
        timestamp: timestampFromValue(message?.timestamp ?? record.timestamp) || options.fallbackTimestamp || null,
        ...totals,
        recordedCostUsd: optionalDecimalString(cost?.total),
      });
      if (event) events.push(event);
    },

    finish(): UsageEvent[] {
      return events;
    },
  };
}

function isModelChange(record: Record<string, unknown>): boolean {
  return (
    stringField(record, "type") === "model_change" ||
    (stringField(record, "type") === "custom" && stringField(record, "customType") === "model-snapshot")
  );
}

function openClawSessionIdFromPath(filePath: string): string | null {
  const filename = path.basename(filePath);
  const index = filename.indexOf(".jsonl");
  if (index < 0) return filename || null;
  const stem = filename.slice(0, index);
  return stem || filename;
}
