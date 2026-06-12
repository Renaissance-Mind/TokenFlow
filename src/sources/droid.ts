import path from "node:path";

import {
  baseTotalsFromRecord,
  isRecord,
  makeUsageEvent,
  recordField,
  stringField,
  timestampFromValue,
  type ParseOptions,
} from "./ccusage-common.js";
import type { UsageEvent } from "../types.js";

export interface DroidParseOptions extends ParseOptions {
  sidecarModel?: string | null;
  fallbackTimestamp?: string | null;
}

export function parseDroidSettings(raw: string, options: DroidParseOptions): UsageEvent | null {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) return null;
  const usage = recordField(value, "tokenUsage");
  if (!usage) return null;

  const provider = normalizeDroidProvider(stringField(value, "providerLock"));
  const rawModel =
    stringField(value, "model") ||
    (options.sidecarModel ? normalizeDroidModelName(options.sidecarModel) : null) ||
    defaultModelFromProvider(provider);
  const model = rawModel ? normalizeDroidModelName(rawModel) || defaultModelFromProvider(provider) : "unknown";
  const totals = baseTotalsFromRecord(usage, {
    input: "inputTokens",
    output: "outputTokens",
    cacheRead: "cacheReadTokens",
    cacheCreation: "cacheCreationTokens",
    reasoning: "thinkingTokens",
    total: "totalTokens",
  });

  return makeUsageEvent({
    agent: "droid",
    model,
    sessionId: droidSessionIdFromPath(options.sourcePath),
    sourcePath: options.sourcePath,
    timestamp: timestampFromValue(value.providerLockTimestamp) || options.fallbackTimestamp || null,
    ...totals,
  });
}

export function normalizeDroidModelName(model: string): string {
  const raw = model.startsWith("custom:") ? model.slice("custom:".length) : model;
  let withoutBrackets = "";
  let bracketDepth = 0;
  for (const char of raw) {
    if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (bracketDepth === 0) {
      withoutBrackets += char;
    }
  }
  return withoutBrackets
    .trim()
    .replace(/-+$/g, "")
    .toLowerCase()
    .replace(/[.\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function extractDroidModelFromLine(line: string): string | null {
  const index = line.indexOf("Model:");
  if (index < 0) return null;
  const raw = line
    .slice(index + "Model:".length)
    .split(/["\\[]/)[0]
    .trim();
  const model = normalizeDroidModelName(raw);
  return model || null;
}

function normalizeDroidProvider(value: string | null): string {
  const normalized = (value || "").trim().toLowerCase().replaceAll("-", "_");
  if (!normalized) return "unknown";
  if (normalized === "claude" || normalized === "anthropic") return "anthropic";
  if (normalized === "google" || normalized === "google_ai" || normalized === "gemini" || normalized === "vertex" || normalized === "vertex_ai") {
    return "google";
  }
  if (normalized === "xai" || normalized === "x_ai" || normalized === "grok") return "xai";
  return normalized;
}

function defaultModelFromProvider(provider: string): string {
  if (provider === "anthropic") return "claude-unknown";
  if (provider === "openai") return "gpt-unknown";
  if (provider === "google") return "gemini-unknown";
  if (provider === "xai") return "grok-unknown";
  return "unknown";
}

function droidSessionIdFromPath(filePath: string): string | null {
  const name = path.basename(filePath);
  return name.endsWith(".settings.json") ? name.slice(0, -".settings.json".length) : name || null;
}
