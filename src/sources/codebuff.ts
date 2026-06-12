import path from "node:path";

import {
  arrayField,
  isRecord,
  makeUsageEvent,
  numberToNonNegativeInt,
  positiveNumberField,
  recordField,
  stringField,
  timestampFromValue,
  type ParseOptions,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

const DEFAULT_CODEBUFF_MODEL = "codebuff-unknown";

interface CodebuffUsage {
  model: string | null;
  credits: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
}

export function parseCodebuffChatMessages(raw: string, options: ParseOptions): UsageEvent[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) return [];
  const context = codebuffContextFromPath(options.sourcePath);
  const chatTimestamp = timestampFromCodebuffChatId(context.chatId);
  const output: UsageEvent[] = [];

  for (const message of value) {
    if (!isRecord(message) || !isAssistantMessage(message)) continue;
    const usage = extractAssistantUsage(message);
    if (!hasUsageSignal(usage)) continue;
    const metadata = recordField(message, "metadata");
    const timestamp =
      timestampFromValue(message.timestamp) || timestampFromValue(message.createdAt) || timestampFromValue(metadata?.timestamp) || chatTimestamp;
    const event = makeUsageEvent({
      agent: "codebuff",
      model: usage.model || DEFAULT_CODEBUFF_MODEL,
      sessionId: context.sessionId,
      sourcePath: options.sourcePath,
      timestamp,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      cacheCreationTokens: usage.cacheCreationTokens,
      cachedInputTokens: usage.cachedInputTokens,
      totalTokens: usage.totalTokens,
    });
    if (event) output.push(event);
  }

  return output;
}

function codebuffContextFromPath(filePath: string): { chatId: string; sessionId: string } {
  const chatId = path.basename(path.dirname(filePath)) || "unknown";
  const chatsDir = path.dirname(path.dirname(filePath));
  const projectDir = path.dirname(chatsDir);
  const project = path.basename(projectDir) || "unknown";
  const channel = path.basename(path.dirname(path.dirname(projectDir))) || "manicode";
  return { chatId, sessionId: `${channel}/${project}/${chatId}` };
}

function isAssistantMessage(message: Record<string, unknown>): boolean {
  const role = stringField(message, "variant") || stringField(message, "role");
  return role === "ai" || role === "agent" || role === "assistant";
}

function extractAssistantUsage(message: Record<string, unknown>): CodebuffUsage {
  let usage = emptyUsage();
  const metadata = recordField(message, "metadata");
  if (metadata) {
    usage.model = stringField(metadata, "model");
    usage = mergeFallback(usage, parseUsageObject(recordField(metadata, "usage")));
    usage = mergeFallback(usage, parseUsageObject(recordField(recordField(metadata, "codebuff"), "usage")));
    const runStateUsage = extractUsageFromRunState(metadata);
    if (runStateUsage) usage = mergeFallback(usage, runStateUsage);
  }
  const credits = positiveNumberField(message, "credits");
  if (credits > 0 && usage.credits <= 0) usage.credits = credits;
  return usage;
}

function extractUsageFromRunState(metadata: Record<string, unknown>): CodebuffUsage | null {
  const mainAgentState = recordField(recordField(recordField(metadata, "runState"), "sessionState"), "mainAgentState");
  const items = arrayField(mainAgentState, "messageHistory");
  if (!Array.isArray(items)) return null;

  let usage = emptyUsage();
  let found = false;
  for (const item of [...items].reverse()) {
    if (!isRecord(item) || stringField(item, "role") !== "assistant") continue;
    const providerOptions = recordField(item, "providerOptions");
    if (!providerOptions) continue;
    let entryUsage = parseUsageObject(recordField(providerOptions, "usage"));
    const codebuff = recordField(providerOptions, "codebuff");
    if (codebuff) {
      entryUsage = mergeFallback(entryUsage, parseUsageObject(recordField(codebuff, "usage")));
      entryUsage.model = stringField(codebuff, "model") || entryUsage.model;
    }
    if (hasUsageSignal(entryUsage) || entryUsage.model) found = true;
    usage = mergeFallback(usage, entryUsage);
  }
  return found ? usage : null;
}

function parseUsageObject(record: Record<string, unknown> | null): CodebuffUsage {
  const usage = emptyUsage();
  if (!record) return usage;
  usage.inputTokens = pickInt(record, ["inputTokens", "input_tokens", "promptTokens", "prompt_tokens"]);
  usage.outputTokens = pickInt(record, ["outputTokens", "output_tokens", "completionTokens", "completion_tokens"]);
  usage.cachedInputTokens = Math.max(
    pickInt(record, ["cacheReadInputTokens", "cache_read_input_tokens"]),
    pickNestedInt(record, "promptTokensDetails", ["cachedTokens"]),
    pickNestedInt(record, "prompt_tokens_details", ["cached_tokens"]),
  );
  usage.cacheCreationTokens = pickInt(record, [
    "cacheCreationInputTokens",
    "cache_creation_input_tokens",
    "cacheCreationTokens",
    "cache_creation_tokens",
    "cachedTokensCreated",
    "cached_tokens_created",
  ]);
  usage.totalTokens = pickInt(record, ["totalTokens", "total_tokens", "total"]);
  usage.credits = positiveNumberField(record, "credits");
  usage.model = stringField(record, "model");
  return usage;
}

function mergeFallback(target: CodebuffUsage, fallback: CodebuffUsage): CodebuffUsage {
  return {
    model: target.model || fallback.model,
    credits: target.credits > 0 ? target.credits : fallback.credits,
    inputTokens: target.inputTokens || fallback.inputTokens,
    outputTokens: target.outputTokens || fallback.outputTokens,
    cacheCreationTokens: target.cacheCreationTokens || fallback.cacheCreationTokens,
    cachedInputTokens: target.cachedInputTokens || fallback.cachedInputTokens,
    totalTokens: target.totalTokens || fallback.totalTokens,
  };
}

function hasUsageSignal(usage: CodebuffUsage): boolean {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheCreationTokens > 0 ||
    usage.cachedInputTokens > 0 ||
    usage.totalTokens > 0 ||
    usage.credits > 0
  );
}

function emptyUsage(): CodebuffUsage {
  return {
    model: null,
    credits: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cachedInputTokens: 0,
    totalTokens: 0,
  };
}

function pickInt(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = numberToNonNegativeInt(record[key]);
    if (value > 0) return value;
  }
  return 0;
}

function pickNestedInt(record: Record<string, unknown>, key: string, keys: string[]): number {
  const nested = recordField(record, key);
  return nested ? pickInt(nested, keys) : 0;
}

function timestampFromCodebuffChatId(chatId: string): string | null {
  const [date, rawTime] = chatId.split("T");
  if (!date || !rawTime) return null;
  let time = rawTime;
  for (let index = 0; index < 2; index += 1) {
    const dash = time.indexOf("-");
    if (dash < 0) break;
    time = `${time.slice(0, dash)}:${time.slice(dash + 1)}`;
  }
  return timestampFromValue(`${date}T${time}`);
}
