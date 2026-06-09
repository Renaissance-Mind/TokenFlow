import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseClaudeJsonl } from "./sources/claude.js";
import {
  parseCcSwitchPricingRow,
  parseCcSwitchRequestLogRow,
  type CcSwitchPricingRow,
  type CcSwitchRequestLogRow,
} from "./sources/cc-switch.js";
import { parseCodexJsonl } from "./sources/codex.js";
import { parseGeminiSession } from "./sources/gemini.js";
import { parseOpenCodeMessageRow, type OpenCodeMessageRow } from "./sources/opencode.js";
import type { PricingProfile, UsageEvent } from "./types.js";

const execFileAsync = promisify(execFile);

export interface SourceStatus {
  agent: string;
  path: string;
  files: number;
  exists: boolean;
}

export interface CollectionResult {
  events: UsageEvent[];
  pricingProfiles: PricingProfile[];
  sources: SourceStatus[];
}

export async function collectLocalUsage(home = os.homedir()): Promise<CollectionResult> {
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const claudeHome = process.env.CLAUDE_HOME || path.join(home, ".claude");
  const geminiHome = process.env.GEMINI_HOME || path.join(home, ".gemini");
  const opencodeDbPath = resolveOpenCodeDbPath(home);
  const ccSwitchDbPath = resolveCcSwitchDbPath(home);
  const ccSwitchDbExists = await exists(ccSwitchDbPath);
  const ccSwitchUsageEnabled = Boolean(process.env.CC_SWITCH_DB?.trim());

  const codexFiles = [
    ...(await listFiles(path.join(codexHome, "sessions"), (file) =>
      path.basename(file).startsWith("rollout-") && file.endsWith(".jsonl"),
    )),
    ...(await listFiles(path.join(codexHome, "archived_sessions"), (file) => file.endsWith(".jsonl"), 1)),
  ];
  const claudeFiles = await listFiles(path.join(claudeHome, "projects"), (file) => file.endsWith(".jsonl"));
  const geminiFiles = await listFiles(path.join(geminiHome, "tmp"), (file) => {
    const base = path.basename(file);
    return base.startsWith("session-") && base.endsWith(".json");
  });

  const events: UsageEvent[] = [];
  for (const file of codexFiles) {
    const raw = await fs.readFile(file, "utf8");
    events.push(...parseCodexJsonl(raw, { sourcePath: file }));
  }
  for (const file of claudeFiles) {
    const raw = await fs.readFile(file, "utf8");
    events.push(...parseClaudeJsonl(raw, { sourcePath: file }));
  }
  for (const file of geminiFiles) {
    const raw = await fs.readFile(file, "utf8");
    events.push(...parseGeminiSession(raw, { sourcePath: file }));
  }
  const opencodeDbExists = await exists(opencodeDbPath);
  if (opencodeDbExists) {
    events.push(...(await readOpenCodeEvents(opencodeDbPath)));
  }
  if (ccSwitchDbExists && ccSwitchUsageEnabled) {
    events.push(...(await readCcSwitchEvents(ccSwitchDbPath)));
  }

  return {
    events,
    pricingProfiles: ccSwitchDbExists ? await readCcSwitchPricing(ccSwitchDbPath) : [],
    sources: [
      {
        agent: "codex",
        path: path.join(codexHome, "sessions"),
        files: codexFiles.length,
        exists: await exists(path.join(codexHome, "sessions")),
      },
      {
        agent: "claude",
        path: path.join(claudeHome, "projects"),
        files: claudeFiles.length,
        exists: await exists(path.join(claudeHome, "projects")),
      },
      {
        agent: "gemini",
        path: path.join(geminiHome, "tmp"),
        files: geminiFiles.length,
        exists: await exists(path.join(geminiHome, "tmp")),
      },
      {
        agent: "opencode",
        path: opencodeDbPath,
        files: opencodeDbExists ? 1 : 0,
        exists: opencodeDbExists,
      },
      {
        agent: "cc-switch",
        path: ccSwitchDbPath,
        files: ccSwitchDbExists && ccSwitchUsageEnabled ? 1 : 0,
        exists: ccSwitchDbExists,
      },
    ],
  };
}

function resolveOpenCodeDbPath(home: string): string {
  const explicitDb = process.env.OPENCODE_DB?.trim();
  if (explicitDb) {
    if (path.isAbsolute(explicitDb)) return explicitDb;
    return path.join(resolveOpenCodeDataDir(home), explicitDb);
  }
  return path.join(resolveOpenCodeDataDir(home), "opencode.db");
}

function resolveOpenCodeDataDir(home: string): string {
  const explicitHome = process.env.OPENCODE_HOME?.trim();
  if (explicitHome) return explicitHome;
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return path.join(xdgDataHome, "opencode");
  return path.join(home, ".local", "share", "opencode");
}

function resolveCcSwitchDbPath(home: string): string {
  const explicitDb = process.env.CC_SWITCH_DB?.trim();
  if (explicitDb) {
    if (path.isAbsolute(explicitDb)) return explicitDb;
    return path.join(home, explicitDb);
  }
  return path.join(home, ".cc-switch", "cc-switch.db");
}

async function readOpenCodeEvents(dbPath: string): Promise<UsageEvent[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", dbPath, openCodeMessageQuery()], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const events: UsageEvent[] = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as OpenCodeMessageRow;
    const event = parseOpenCodeMessageRow(row, dbPath);
    if (event) events.push(event);
  }
  return events;
}

async function readCcSwitchEvents(dbPath: string): Promise<UsageEvent[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", dbPath, ccSwitchRequestLogQuery()], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const events: UsageEvent[] = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as CcSwitchRequestLogRow;
    const event = parseCcSwitchRequestLogRow(row, dbPath);
    if (event) events.push(event);
  }
  return events;
}

async function readCcSwitchPricing(dbPath: string): Promise<PricingProfile[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", dbPath, ccSwitchPricingQuery()], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const pricing: PricingProfile[] = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    pricing.push(parseCcSwitchPricingRow(JSON.parse(trimmed) as CcSwitchPricingRow));
  }
  return pricing;
}

function openCodeMessageQuery(): string {
  return [
    "SELECT json_object(",
    "'id', m.id,",
    "'session_id', m.session_id,",
    "'time_created', m.time_created,",
    "'data', m.data",
    ")",
    "FROM message m",
    "ORDER BY m.time_created ASC;",
  ].join(" ");
}

function ccSwitchRequestLogQuery(): string {
  return [
    "SELECT json_object(",
    "'request_id', request_id,",
    "'app_type', app_type,",
    "'model', model,",
    "'request_model', request_model,",
    "'input_tokens', input_tokens,",
    "'output_tokens', output_tokens,",
    "'cache_read_tokens', cache_read_tokens,",
    "'cache_creation_tokens', cache_creation_tokens,",
    "'status_code', status_code,",
    "'session_id', session_id,",
    "'created_at', created_at",
    ")",
    "FROM proxy_request_logs",
    "ORDER BY created_at ASC;",
  ].join(" ");
}

function ccSwitchPricingQuery(): string {
  return [
    "SELECT json_object(",
    "'model_id', model_id,",
    "'display_name', display_name,",
    "'input_cost_per_million', input_cost_per_million,",
    "'output_cost_per_million', output_cost_per_million,",
    "'cache_read_cost_per_million', cache_read_cost_per_million,",
    "'cache_creation_cost_per_million', cache_creation_cost_per_million",
    ")",
    "FROM model_pricing",
    "ORDER BY model_id ASC;",
  ].join(" ");
}

async function listFiles(
  root: string,
  predicate: (filePath: string) => boolean,
  maxDepth = 8,
): Promise<string[]> {
  const output: string[] = [];
  await walk(root, predicate, output, 0, maxDepth);
  output.sort((a, b) => a.localeCompare(b));
  return output;
}

async function walk(
  current: string,
  predicate: (filePath: string) => boolean,
  output: string[],
  depth: number,
  maxDepth: number,
): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  });
  if (depth > maxDepth) return;
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(entryPath, predicate, output, depth + 1, maxDepth);
    } else if (entry.isFile() && predicate(entryPath)) {
      output.push(entryPath);
    }
  }
}

async function exists(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then((stat) => stat.isDirectory() || stat.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
