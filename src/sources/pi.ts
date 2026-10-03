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
import type { UsageEvent, AgentSource } from "../types.js";
import fs from "node:fs/promises";
import { optionalJson, readStoreLines, storeFiles } from "./store-io.js";

export function parsePiJsonl(jsonl: string, options: ParseOptions): UsageEvent[] {
  return parseJsonlWithParser(jsonl, createPiJsonlParser(options));
}

export function createPiJsonlParser(options: ParseOptions & { agent?: AgentSource }): JsonlUsageParser {
  const events: UsageEvent[] = [];
  let sessionId = piSessionIdFromPath(options.sourcePath);

  return {
    pushLine(line: string): void {
      if (line.includes('"session"')) {
        const header = JSON.parse(line) as Record<string, unknown>;
        if (header.type === "session") { sessionId = stringField(header, "id") || sessionId; return; }
      }
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
        agent: options.agent || "pi",
        model: stringField(message, "model"),
        sessionId,
        sourcePath: options.sourcePath,
        timestamp: timestampFromValue(record.timestamp),
        ...totals,
        recordedCostUsd: optionalDecimalString(cost?.total),
      });
      if (event) { event.messageId = stringField(record, "id") || undefined; events.push(event); }
    },

    finish(): UsageEvent[] {
      return events;
    },
  };
}

export async function collectPiStores(home: string, defaultRoots: string[]) {
  const stores: Array<{ name: string; roots: string[] }> = [{ name: "pi", roots: defaultRoots }];
  let config: Record<string, unknown> | null = null;
  for (const file of [path.join(process.cwd(), ".ccusage", "ccusage.json"), path.join(home, ".config", "claude", "ccusage.json"), path.join(home, ".claude", "ccusage.json")]) {
    config = await optionalJson(file); if (config) break;
  }
  const pi = recordField(config, "pi");
  const defaults = recordField(pi, "defaults");
  if (!process.env.PI_AGENT_DIR?.trim() && typeof defaults?.piPath === "string") {
    stores[0].roots = [];
    for (const candidate of defaults.piPath.split(",").map((value) => value.trim()).filter(Boolean)) {
      const stat = await fs.stat(candidate).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
      if (stat?.isDirectory()) stores[0].roots.push(candidate);
    }
  }
  const reserved = new Set(["codex", "claude", "gemini", "opencode", "kimi", "qwen", "amp", "codebuff", "droid", "goose", "hermes", "kilo", "openclaw", "pi", "dsh", "grok", "zcode", "antigravity", "unknown"]);
  const names = new Set(reserved);
  const canonical = await Promise.all(stores[0].roots.map((root) => fs.realpath(root)));
  for (const raw of Array.isArray(pi?.stores) ? pi.stores : []) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid ccusage Pi store");
    const store = raw as Record<string, unknown>;
    if (typeof store.name !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(store.name) || names.has(store.name) || typeof store.path !== "string") throw new Error("Invalid or duplicate ccusage Pi store name/path");
    names.add(store.name);
    const roots: string[] = [];
    for (const item of store.path.split(",").map((value) => value.trim()).filter(Boolean)) {
      const root = await fs.realpath(item.replace(/^~(?=\/|$)/, home)).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
      if (!root) continue;
      if (canonical.some((old) => root === old || root.startsWith(`${old}${path.sep}`) || old.startsWith(`${root}${path.sep}`))) throw new Error("Overlapping ccusage Pi store paths");
      canonical.push(root); roots.push(root);
    }
    stores.push({ name: store.name, roots });
  }
  const events: UsageEvent[] = [];
  const sources = [];
  for (const store of stores) {
    const files = (await Promise.all(store.roots.map((root) => storeFiles(root,
      (file) => file.endsWith(".jsonl") && !file.split(path.sep).includes("subagent-artifacts"))))).flat();
    const sessions = new Map<string, { events: UsageEvent[]; parent?: string; time?: string }>();
    for (const file of files) {
      const parser = createPiJsonlParser({ sourcePath: file, agent: store.name as AgentSource });
      let parent: string | undefined;
      let time: string | undefined;
      await readStoreLines(file, (line) => {
        if (line.includes('"session"')) {
          const row = JSON.parse(line) as Record<string, unknown>;
          if (row.type === "session") {
            if (typeof row.parentSession === "string") parent = path.resolve(path.dirname(file), row.parentSession.replace(/^~(?=\/|$)/, home));
            time = timestampFromValue(row.timestamp) || undefined;
          }
        }
        parser.pushLine(line);
      });
      sessions.set(path.resolve(file), { events: parser.finish(), parent, time });
    }
    const seen = new Set<string>();
    const key = (event: UsageEvent) => [event.timestamp, event.model, event.inputTokens, event.outputTokens, event.cachedInputTokens, event.cacheCreationTokens, event.totalTokens, event.recordedCostUsd].join("|");
    for (const [file, session] of sessions) {
      const ancestry = new Set([file]); let ancestor = session.parent; let valid = true;
      while (ancestor) { if (ancestry.has(ancestor) || !sessions.has(ancestor)) { valid = false; break; } ancestry.add(ancestor); ancestor = sessions.get(ancestor)?.parent; }
      const prefix = valid && session.parent && session.time ? sessions.get(session.parent)?.events.filter((event) => event.timestamp <= session.time!) || [] : [];
      let index = 0;
      for (const event of session.events) {
        if (prefix[index] && key(event) === key(prefix[index])) { index++; continue; }
        index = prefix.length;
        const identity = `${event.sessionId}|${key(event)}`;
        if (!seen.has(identity)) { seen.add(identity); events.push(event); }
      }
    }
    sources.push({ agent: store.name, path: store.roots.join(","), files: files.length, exists: store.roots.length > 0 });
  }
  return { events, sources };
}

function piSessionIdFromPath(filePath: string): string | null {
  const filename = path.basename(filePath, path.extname(filePath));
  if (!filename) return null;
  return filename.includes("_") ? filename.slice(filename.indexOf("_") + 1) : filename;
}
