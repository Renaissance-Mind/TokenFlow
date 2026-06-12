import {
  arrayField,
  baseTotalsFromRecord,
  isRecord,
  makeUsageEvent,
  recordField,
  stringField,
  timestampFromValue,
  type ParseOptions,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

export function parseAmpThread(raw: string, options: ParseOptions): UsageEvent[] {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) return [];
  const threadId = stringField(value, "id");
  if (!threadId) return [];

  const messages = arrayField(value, "messages");
  const ledgerEvents = arrayField(recordField(value, "usageLedger"), "events");
  if (ledgerEvents) {
    return parseLedgerEvents(ledgerEvents, cacheTokensByMessageId(messages), threadId, options.sourcePath);
  }
  return parseMessageUsage(messages, threadId, options.sourcePath);
}

function parseLedgerEvents(
  events: unknown[],
  cacheTokens: Map<number, { cacheCreationTokens: number; cachedInputTokens: number }>,
  threadId: string,
  sourcePath: string,
): UsageEvent[] {
  const output: UsageEvent[] = [];
  for (const item of events) {
    if (!isRecord(item)) continue;
    const tokens = recordField(item, "tokens");
    const model = stringField(item, "model");
    if (!tokens || !model) continue;
    const messageId = Number(item.toMessageId);
    const cache = Number.isFinite(messageId) ? cacheTokens.get(messageId) : undefined;
    const totals = baseTotalsFromRecord(tokens, {
      input: "input",
      output: "output",
      total: "total",
    });
    const event = makeUsageEvent({
      agent: "amp",
      model,
      sessionId: threadId,
      sourcePath,
      timestamp: timestampFromValue(item.timestamp),
      ...totals,
      cachedInputTokens: cache?.cachedInputTokens || totals.cachedInputTokens,
      cacheCreationTokens: cache?.cacheCreationTokens || totals.cacheCreationTokens,
    });
    if (event) output.push(event);
  }
  return output;
}

function parseMessageUsage(messages: unknown[] | null, threadId: string, sourcePath: string): UsageEvent[] {
  const output: UsageEvent[] = [];
  for (const item of messages || []) {
    if (!isRecord(item)) continue;
    if (stringField(item, "role") !== "assistant") continue;
    const usage = recordField(item, "usage");
    if (!usage) continue;
    const model = stringField(usage, "model") || stringField(item, "model");
    if (!model) continue;
    const totals = baseTotalsFromRecord(usage, {
      input: "inputTokens",
      output: "outputTokens",
      cacheRead: "cacheReadInputTokens",
      cacheCreation: "cacheCreationInputTokens",
      total: "totalTokens",
    });
    const event = makeUsageEvent({
      agent: "amp",
      model,
      sessionId: threadId,
      sourcePath,
      timestamp: timestampFromValue(usage.timestamp ?? item.timestamp),
      ...totals,
    });
    if (event) output.push(event);
  }
  return output;
}

function cacheTokensByMessageId(
  messages: unknown[] | null,
): Map<number, { cacheCreationTokens: number; cachedInputTokens: number }> {
  const output = new Map<number, { cacheCreationTokens: number; cachedInputTokens: number }>();
  for (const item of messages || []) {
    if (!isRecord(item)) continue;
    if (stringField(item, "role") !== "assistant") continue;
    const messageId = Number(item.messageId);
    if (!Number.isFinite(messageId)) continue;
    const usage = recordField(item, "usage");
    output.set(messageId, {
      cacheCreationTokens: Number(usage?.cacheCreationInputTokens || 0),
      cachedInputTokens: Number(usage?.cacheReadInputTokens || 0),
    });
  }
  return output;
}
