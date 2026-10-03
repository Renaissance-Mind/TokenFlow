import path from "node:path";
import {
  makeUsageEvent,
  optionalDecimalString,
  recordField,
  stringField,
  type JsonlUsageParser,
} from "./ccusage-common.js";
import { nonNegativeInt } from "../token-totals.js";
import {
  optionalJson,
  readStoreLines,
  sourceRoots,
  storeFiles,
} from "./store-io.js";
import type { UsageEvent } from "../types.js";

export function createGrokParser(
  sourcePath: string,
  fallbackModel = "unknown",
  seen = new Set<string>(),
): JsonlUsageParser {
  const events: UsageEvent[] = [];
  return {
    pushLine(line) {
      if (!line.includes("turn_completed")) return;
      const row = JSON.parse(line) as Record<string, unknown>;
      const params = recordField(row, "params");
      const update = recordField(params, "update");
      if (update?.sessionUpdate !== "turn_completed") return;
      const usage = recordField(update, "usage");
      if (!usage) return;
      const meta = recordField(params, "_meta");
      const millis =
        Number(meta?.agentTimestampMs) || Number(row.timestamp) * 1000;
      if (!Number.isFinite(millis) || millis <= 0) return;
      const sessionId =
        stringField(params, "sessionId") ||
        path.basename(path.dirname(sourcePath));
      const models = recordField(usage, "modelUsage");
      for (const [model, value] of Object.entries(
        models && Object.keys(models).length
          ? models
          : { [fallbackModel]: usage },
      )) {
        if (!value || typeof value !== "object") continue;
        const tokens = value as Record<string, unknown>;
        const input = nonNegativeInt(tokens.inputTokens);
        const cached = Math.min(input, nonNegativeInt(tokens.cachedReadTokens));
        const created = Math.min(
          input - cached,
          nonNegativeInt(tokens.cacheCreationTokens),
        );
        const output = nonNegativeInt(tokens.outputTokens);
        const id = stringField(meta, "eventId");
        const key = id
          ? `${id}|${model}`
          : `${sessionId}|${millis}|${model}|${input}|${cached}|${created}|${output}`;
        if (seen.has(key)) continue;
        const event = makeUsageEvent({
          agent: "grok",
          model,
          sessionId,
          sourcePath,
          timestamp: new Date(millis).toISOString(),
          inputTokens: input - cached - created,
          cachedInputTokens: cached,
          cacheCreationTokens: created,
          outputTokens: output,
          recordedCostUsd:
            Number(tokens.costUsdTicks) > 0
              ? optionalDecimalString(Number(tokens.costUsdTicks) / 1e10)
              : undefined,
        });
        if (event) {
          event.pricingModel = model.endsWith("-build") ? model.replace(/-build$/, "") : event.pricingModel || event.model;
          seen.add(key);
          events.push(event);
        }
      }
    },
    finish: () => events,
  };
}

export async function collectGrok(home: string) {
  const roots = sourceRoots("GROK_HOME", home, [".grok"]);
  const files = (
    await Promise.all(
      roots.map((root) =>
        storeFiles(
          path.join(root, "sessions"),
          (file) => path.basename(file) === "updates.jsonl",
        ),
      ),
    )
  ).flat();
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const summary = await optionalJson(
      path.join(path.dirname(file), "summary.json"),
    );
    const parser = createGrokParser(
      file,
      stringField(summary, "current_model_id") || "unknown",
      seen,
    );
    await readStoreLines(file, parser.pushLine);
    events.push(...parser.finish());
  }
  return {
    events,
    source: {
      agent: "grok",
      path: roots.join(","),
      files: files.length,
      exists: files.length > 0,
    },
  };
}
