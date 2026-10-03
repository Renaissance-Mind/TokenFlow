import path from "node:path";
import { makeUsageEvent } from "./ccusage-common.js";
import { nonNegativeInt } from "../token-totals.js";
import {
  sourceRoots,
  sqliteRows,
  storeFiles,
  tableColumns,
} from "./store-io.js";
import type { UsageEvent } from "../types.js";

export function parseZcodeRow(
  row: Record<string, unknown>,
  sourcePath: string,
): UsageEvent | null {
  const input = nonNegativeInt(row.input_tokens);
  const cached = Math.min(input, nonNegativeInt(row.cache_read_input_tokens));
  const created = Math.min(
    input - cached,
    nonNegativeInt(row.cache_creation_input_tokens),
  );
  const time = Number(row.started_at);
  if (
    !row.id ||
    !row.session_id ||
    !row.model_id ||
    !Number.isFinite(time) ||
    time <= 0
  )
    return null;
  const model = String(row.model_id);
  const event = makeUsageEvent({
    agent: "zcode",
    model,
    sourcePath,
    sessionId: String(row.session_id),
    timestamp: new Date(time).toISOString(),
    inputTokens: input - cached - created,
    cachedInputTokens: cached,
    cacheCreationTokens: created,
    outputTokens: nonNegativeInt(row.output_tokens),
    totalTokens: nonNegativeInt(row.computed_total_tokens),
  });
  if (event && row.provider_id) {
    const provider = String(row.provider_id).toLowerCase();
    event.pricingModel = [
      "zai",
      "z.ai",
      "zai-coding-plan",
      "builtin:zai-coding-plan",
      "builtin:bigmodel-coding-plan",
    ].includes(provider)
      ? `zai/${model.toLowerCase()}`
      : `unpriced-zcode-custom-${model.toLowerCase()}`;
  } else if (event && /^glm[-/]/i.test(model))
    event.pricingModel = `zai/${model.toLowerCase()}`;
  return event;
}

export async function collectZcode(home: string) {
  const roots = sourceRoots("ZCODE_HOME", home, [".zcode"]);
  const files = (
    await Promise.all(
      roots.map((root) =>
        storeFiles(
          path.join(root, "cli", "db"),
          (file) => path.basename(file) === "db.sqlite",
        ),
      ),
    )
  ).flat();
  const events: UsageEvent[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const columns = await tableColumns(file, "model_usage");
    const sessions = await tableColumns(file, "session");
    if (
      ![
        "id",
        "session_id",
        "started_at",
        "model_id",
        "status",
        "input_tokens",
        "output_tokens",
      ].every((column) => columns.has(column)) ||
      !["id", "directory"].every((column) => sessions.has(column))
    )
      continue;
    const optional = [
      "provider_id",
      "cache_creation_input_tokens",
      "cache_read_input_tokens",
      "computed_total_tokens",
    ].map(
      (column) =>
        `${columns.has(column) ? `m.${column}` : "NULL"} AS ${column}`,
    );
    const rows = await sqliteRows<Record<string, unknown>>(
      file,
      `SELECT m.id,m.session_id,m.started_at,m.model_id,m.input_tokens,m.output_tokens,${optional.join(",")}
       FROM model_usage m LEFT JOIN session s ON s.id=m.session_id WHERE m.status='completed' ORDER BY m.started_at,m.id;`,
    );
    for (const row of rows) {
      if (seen.has(String(row.id))) continue;
      const event = parseZcodeRow(row, file);
      if (event) {
        seen.add(String(row.id));
        events.push(event);
      }
    }
  }
  return {
    events,
    source: {
      agent: "zcode",
      path: roots.join(","),
      files: files.length,
      exists: files.length > 0,
    },
  };
}
