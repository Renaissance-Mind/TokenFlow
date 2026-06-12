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

export function parsePiJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  return parseJsonlWithParser(jsonl, createPiJsonlParser(options));
}

export function createPiJsonlParser(options: ParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];
  const sessionId = piSessionIdFromPath(options.sourcePath);

  return {
    pushLine(line: string): void {
      if (!line.includes("\"usage\"") || !line.includes("\"message\"")) return;
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;
      const type = stringField(record, "type");
      if (type && type !== "message") return;

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
        agent: "pi",
        model: stringField(message, "model"),
        sessionId,
        sourcePath: options.sourcePath,
        timestamp: timestampFromValue(record.timestamp),
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

function piSessionIdFromPath(filePath: string): string | null {
  const filename = path.basename(filePath, path.extname(filePath));
  if (!filename) return null;
  return filename.includes("_") ? filename.slice(filename.indexOf("_") + 1) : filename;
}
