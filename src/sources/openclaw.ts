import path from "node:path";
import { sqliteRows, storeFiles, tableColumns } from "./store-io.js";

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
  sessionId?: string;
}

export function parseOpenClawJsonl(jsonl: string, options: OpenClawParseOptions): UsageEvent[] {
  return parseJsonlWithParser(jsonl, createOpenClawJsonlParser(options));
}

export function createOpenClawJsonlParser(options: OpenClawParseOptions): JsonlUsageParser {
  const events: UsageEvent[] = [];
  const sessionId = options.sessionId || openClawSessionIdFromPath(options.sourcePath);
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
      if (event) {
        event.messageId = stringField(record, "id") || stringField(message, "id") || undefined;
        events.push(event);
      }
    },

    finish(): UsageEvent[] {
      return events;
    },
  };
}

function migrationKey(event: UsageEvent): string {
  return [event.sessionId, event.timestamp, event.model, event.inputTokens, event.outputTokens,
    event.cachedInputTokens, event.cacheCreationTokens, event.extraTotalTokens || 0].join("|");
}

export function mergeOpenClawStores(jsonl: UsageEvent[], database: UsageEvent[]): UsageEvent[] {
  const entries = new Map<string, UsageEvent>();
  for (const event of jsonl) {
    const key = `${migrationKey(event)}|${event.recordedCostUsd || ""}`;
    if (!entries.has(key)) entries.set(key, event);
  }
  const ids = new Set<string>();
  for (const event of database) {
    const id = event.messageId ? `${event.sessionId}|${event.messageId}` : migrationKey(event);
    if (ids.has(id)) continue;
    ids.add(id);
    for (const [key, old] of entries) {
      if (migrationKey(old) === migrationKey(event) || (event.messageId && old.sessionId === event.sessionId && old.messageId === event.messageId)) entries.delete(key);
    }
    entries.set(`sqlite|${id}`, event);
  }
  return [...entries.values()];
}

export async function collectOpenClawDatabases(roots: string[]) {
  const files = (await Promise.all(roots.map((root) => storeFiles(path.join(root, "agents"),
    (file) => path.basename(file) === "openclaw-agent.sqlite" && path.basename(path.dirname(file)) === "agent")))).flat();
  const events: UsageEvent[] = [];
  for (const file of files) {
    const columns = await tableColumns(file, "transcript_events");
    if (!["session_id", "seq", "event_json", "created_at"].every((column) => columns.has(column))) continue;
    const rows = await sqliteRows<{ session_id: string; event_json: string; created_at: number }>(file,
      "SELECT session_id,event_json,created_at FROM transcript_events ORDER BY session_id,seq;");
    let session = "";
    let parser: JsonlUsageParser | null = null;
    for (const row of rows) {
      if (session !== row.session_id) {
        if (parser) events.push(...parser.finish());
        session = row.session_id;
        parser = createOpenClawJsonlParser({ sourcePath: file, sessionId: session, fallbackTimestamp: timestampFromValue(row.created_at) });
      }
      // SQLite transcripts may contain an interrupted or redacted JSON row.
      let value: Record<string, unknown>;
      try { value = JSON.parse(row.event_json); } catch { continue; }
      if (!value.timestamp) value.timestamp = timestampFromValue(row.created_at);
      parser?.pushLine(JSON.stringify(value));
    }
    if (parser) events.push(...parser.finish());
  }
  return { events, files };
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
