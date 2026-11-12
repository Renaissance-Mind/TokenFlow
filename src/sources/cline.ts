import fs from "node:fs/promises";
import path from "node:path";
import { cachedSource, checkCollectionCancellation } from "../collection-cache.js";
import { appendItems } from "../arrays.js";
import { scanFile } from "../scan-progress.js";
import { isRecord, makeUsageEvent, optionalDecimalString, recordField, stringField } from "./ccusage-common.js";
import { storeFiles } from "./store-io.js";
import type { UsageEvent } from "../types.js";

type Kind = "extension" | "cli";
interface Source { file: string; kind: Kind; session: string }

export function parseClineDocument(root: unknown, source: Source): UsageEvent[] {
  const rows = source.kind === "extension" ? root : isRecord(root) ? root.messages : null;
  if (!Array.isArray(rows)) return [];
  const events: UsageEvent[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    let metrics: Record<string, unknown> | null, info = recordField(row, "modelInfo"), timestamp: string | null;
    if (source.kind === "extension") {
      if (row.type !== "say" || row.say !== "api_req_started" || row.partial === true || typeof row.text !== "string") continue;
      let payload: unknown;
      try { payload = JSON.parse(row.text); } catch { continue; }
      metrics = isRecord(payload) ? payload : null;
      timestamp = millis(row.ts);
    } else {
      if (row.role !== "assistant") continue;
      metrics = recordField(row, "metrics");
      timestamp = "ts" in row ? millis(row.ts) : typeof row.timestamp === "string" && /T.*(?:Z|[+-]\d\d:\d\d)$/i.test(row.timestamp) && Number.isFinite(Date.parse(row.timestamp)) ? new Date(row.timestamp).toISOString() : null;
    }
    const model = stringField(info, source.kind === "extension" ? "modelId" : "id");
    if (!model || model.toLowerCase() === "unknown" || !timestamp || !metrics) continue;
    const keys = source.kind === "extension" ? ["tokensIn", "tokensOut", "cacheReads", "cacheWrites"] : ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"];
    const values = keys.map(key => metrics![key]);
    if (!values.every(value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) continue;
    const [input, output, read, write] = values as number[];
    if (!Number.isSafeInteger(read + write)) continue;
    const fresh = source.kind === "cli" ? input - read - write : input;
    const total = fresh + output + read + write;
    if (fresh < 0 || total <= 0 || !Number.isSafeInteger(total)) continue;
    const provider = stringField(info, source.kind === "extension" ? "providerId" : "provider");
    const pricingModel = !provider || model.includes("/") ? model : `${provider}/${model}`;
    const cost = typeof metrics.cost === "number" || typeof metrics.cost === "string" ? optionalDecimalString(metrics.cost) : undefined;
    const event = makeUsageEvent({ agent: "cline", model: pricingModel,
      sessionId: `${source.kind === "cli" ? "cli" : "task"}:${source.session}`, sourcePath: source.file, timestamp,
      inputTokens: fresh, outputTokens: output, cachedInputTokens: read, cacheCreationTokens: write, recordedCostUsd: cost });
    if (event) events.push({ ...event, model, pricingModel });
  }
  return events;
}

function millis(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) return null;
  return new Date(value).toISOString();
}

function classify(root: string, file: string): Source | null {
  const parts = path.relative(root, file).split(path.sep);
  if ((parts.length === 3 && parts[0] === "tasks") || (parts.length === 4 && parts[0] === "data" && parts[1] === "tasks")) {
    return parts.at(-1) === "ui_messages.json" ? { file, kind: "extension", session: parts.at(-2)! } : null;
  }
  if ((parts.length === 3 && parts[0] === "sessions") || (parts.length === 4 && parts[0] === "data" && parts[1] === "sessions")) {
    const session = parts.at(-2)!;
    return parts.at(-1) === `${session}.messages.json` ? { file, kind: "cli", session } : null;
  }
  return null;
}

export async function planCline(home: string) {
  const editors = ["Code", "Code - Insiders", "Cursor", "Windsurf", "VSCodium"];
  const storage = (base: string, editor: string) => path.join(base, editor, "User/globalStorage/saoudrizwan.claude-dev");
  const defaults = [path.join(home, ".cline"), ...editors.flatMap(editor => [
    storage(path.join(home, "Library/Application Support"), editor),
    storage(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), editor),
    storage(process.env.APPDATA || path.join(process.env.USERPROFILE || home, "AppData/Roaming"), editor),
  ])];
  const roots = process.env.CLINE_DATA_DIR !== undefined ? process.env.CLINE_DATA_DIR.split(",").map(root => root.trim()).filter(Boolean) : defaults;
  const sources: Source[] = [], seen = new Set<string>();
  for (const root of roots) for (const file of await storeFiles(root, file => file.endsWith("ui_messages.json") || file.endsWith(".messages.json"))) {
    const source = classify(root, file);
    if (!source) continue;
    const identity = await fs.realpath(file);
    if (seen.has(identity)) continue;
    seen.add(identity); sources.push(source);
  }
  sources.sort((a, b) => a.file.localeCompare(b.file));
  return { files: sources.map(source => source.file), collect: async () => {
    const events: UsageEvent[] = [], warnings: string[] = [], skippedFiles: string[] = [];
    for (const source of sources) {
      try {
        const parsed = await scanFile(source.file, () => cachedSource("cline", [source.file], async () => parseClineDocument(JSON.parse(await fs.readFile(source.file, "utf8")), source)));
        appendItems(events, parsed);
      } catch (error) {
        checkCollectionCancellation();
        if (!(error instanceof SyntaxError) && !(error instanceof Error && "path" in error && error.path === source.file)) throw error;
        warnings.push(`Skipping unreadable Cline file '${source.file}': ${error instanceof Error ? error.message : String(error)}`);
        skippedFiles.push(source.file);
      }
    }
    return { events, source: { agent: "cline", path: roots.join(","), files: sources.length, exists: sources.length > 0,
      ...(warnings.length ? { warnings, skippedFiles } : {}) } };
  } };
}
