import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { parseAmpThread } from "./sources/amp.js";
import { createClaudeJsonlParser } from "./sources/claude.js";
import { createCodexJsonlParser } from "./sources/codex.js";
import { parseCodebuffChatMessages } from "./sources/codebuff.js";
import { extractDroidModelFromLine, parseDroidSettings } from "./sources/droid.js";
import { parseGeminiSession } from "./sources/gemini.js";
import { parseGooseSessionRow, type GooseSessionRow } from "./sources/goose.js";
import { parseHermesSessionRow, type HermesSessionRow } from "./sources/hermes.js";
import { parseKiloMessageRow, type KiloMessageRow } from "./sources/kilo.js";
import { createKimiWireJsonlParser } from "./sources/kimi.js";
import { parseOpenCodeMessageRow, type OpenCodeMessageRow } from "./sources/opencode.js";
import { createOpenClawJsonlParser } from "./sources/openclaw.js";
import { createPiJsonlParser } from "./sources/pi.js";
import { createQwenChatJsonlParser } from "./sources/qwen.js";
import type { PricingProfile, UsageEvent } from "./types.js";

const execFileAsync = promisify(execFile);
const MAX_JSONL_LINE_CHARS = 16 * 1024 * 1024;

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
}

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
  const opencodeDataDirs = await existingDirs(resolveOpenCodeDataDirs(home));
  const opencodeDbPaths = await discoverOpenCodeDbPaths(home, opencodeDataDirs);
  const kimiRoots = await existingDirs(resolveDataDirs("KIMI_DATA_DIR", home, ".kimi"));
  const qwenRoots = await existingDirs(resolveDataDirs("QWEN_DATA_DIR", home, ".qwen"));
  const ampRoots = await existingDirs(resolveDataDirs("AMP_DATA_DIR", home, ".local/share/amp"));
  const codebuffProjectRoots = await existingDirs(resolveCodebuffProjectRoots(home));
  const droidRoots = await existingDirs(resolveDataDirs("DROID_SESSIONS_DIR", home, ".factory/sessions"));
  const gooseDbPaths = await existingFiles(resolveGooseDbPaths(home));
  const hermesDbPaths = await existingFiles(resolveHermesDbPaths(home));
  const kiloRoots = await existingDirs(resolveDataDirs("KILO_DATA_DIR", home, ".local/share/kilo"));
  const openclawRoots = await existingDirs(resolveOpenClawRoots(home));
  const piRoots = await existingDirs(resolveDataDirs("PI_AGENT_DIR", home, ".pi/agent/sessions"));

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
  const kimiFiles = await listFilesForRoots(kimiRoots.map((root) => path.join(root, "sessions")), isKimiWireFile);
  const qwenFiles = await listFilesForRoots(qwenRoots.map((root) => path.join(root, "projects")), isQwenChatFile);
  const ampFiles = await listFilesForRoots(
    ampRoots.map((root) => path.join(root, "threads")),
    (file) => file.endsWith(".json"),
  );
  const codebuffFiles = await listFilesForRoots(codebuffProjectRoots, isCodebuffChatMessagesFile);
  const droidFiles = await listFilesForRoots(droidRoots, isDroidSettingsFile);
  const kiloDbPaths = await existingFiles(kiloRoots.map((root) => path.join(root, "kilo.db")));
  const openclawFiles = await listFilesForRoots(openclawRoots, isOpenClawSessionFile);
  const piFiles = await listFilesForRoots(piRoots, (file) => file.endsWith(".jsonl"));
  const opencodeMessageFiles = await listFilesForRoots(
    opencodeDataDirs.map((root) => path.join(root, "storage", "message")),
    (file) => file.endsWith(".json"),
  );

  const events: UsageEvent[] = [];
  for (const file of codexFiles) {
    events.push(...(await readJsonlEvents(file, createCodexJsonlParser)));
  }
  for (const file of claudeFiles) {
    events.push(...(await readJsonlEvents(file, createClaudeJsonlParser)));
  }
  for (const file of geminiFiles) {
    const raw = await fs.readFile(file, "utf8");
    events.push(...parseGeminiSession(raw, { sourcePath: file }));
  }
  for (const file of kimiFiles) {
    const model = await readKimiModelForWireFile(file);
    events.push(...(await readJsonlEvents(file, (options) => createKimiWireJsonlParser({ ...options, model }))));
  }
  for (const file of qwenFiles) {
    events.push(...(await readJsonlEvents(file, createQwenChatJsonlParser)));
  }
  for (const file of ampFiles) {
    const raw = await fs.readFile(file, "utf8");
    events.push(...parseAmpThread(raw, { sourcePath: file }));
  }
  for (const file of codebuffFiles) {
    const raw = await fs.readFile(file, "utf8");
    events.push(...parseCodebuffChatMessages(raw, { sourcePath: file }));
  }
  const droidEvents: UsageEvent[] = [];
  for (const file of droidFiles) {
    const raw = await fs.readFile(file, "utf8");
    const event = parseDroidSettings(raw, {
      sourcePath: file,
      sidecarModel: await readDroidSidecarModel(file),
      fallbackTimestamp: await fileModifiedTimestamp(file),
    });
    if (event) droidEvents.push(event);
  }
  events.push(...latestEventsBySession(droidEvents));
  for (const dbPath of gooseDbPaths) {
    events.push(...(await readGooseEvents(dbPath)));
  }
  for (const dbPath of hermesDbPaths) {
    events.push(...(await readHermesEvents(dbPath)));
  }
  for (const dbPath of kiloDbPaths) {
    events.push(...(await readKiloEvents(dbPath)));
  }
  for (const file of openclawFiles) {
    const fallbackTimestamp = await fileModifiedTimestamp(file);
    events.push(...(await readJsonlEvents(file, (options) => createOpenClawJsonlParser({ ...options, fallbackTimestamp }))));
  }
  for (const file of piFiles) {
    events.push(...(await readJsonlEvents(file, createPiJsonlParser)));
  }
  const opencodeEvents = await readOpenCodeEvents(opencodeDbPaths, opencodeMessageFiles);
  events.push(...opencodeEvents.events);

  return {
    events,
    pricingProfiles: [],
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
        path: sourcePathLabel(opencodeEvents.sourcePaths, resolveOpenCodeDataDirs(home)),
        files: opencodeEvents.sourcePaths.length,
        exists: opencodeEvents.sourcePaths.length > 0,
      },
      {
        agent: "kimi",
        path: sourcePathLabel(kimiRoots, resolveDataDirs("KIMI_DATA_DIR", home, ".kimi")),
        files: kimiFiles.length,
        exists: kimiRoots.length > 0,
      },
      {
        agent: "qwen",
        path: sourcePathLabel(qwenRoots, resolveDataDirs("QWEN_DATA_DIR", home, ".qwen")),
        files: qwenFiles.length,
        exists: qwenRoots.length > 0,
      },
      {
        agent: "amp",
        path: sourcePathLabel(ampRoots, resolveDataDirs("AMP_DATA_DIR", home, ".local/share/amp")),
        files: ampFiles.length,
        exists: ampRoots.length > 0,
      },
      {
        agent: "codebuff",
        path: sourcePathLabel(codebuffProjectRoots, resolveCodebuffProjectRoots(home)),
        files: codebuffFiles.length,
        exists: codebuffProjectRoots.length > 0,
      },
      {
        agent: "droid",
        path: sourcePathLabel(droidRoots, resolveDataDirs("DROID_SESSIONS_DIR", home, ".factory/sessions")),
        files: droidFiles.length,
        exists: droidRoots.length > 0,
      },
      {
        agent: "goose",
        path: sourcePathLabel(gooseDbPaths, resolveGooseDbPaths(home)),
        files: gooseDbPaths.length,
        exists: gooseDbPaths.length > 0,
      },
      {
        agent: "hermes",
        path: sourcePathLabel(hermesDbPaths, resolveHermesDbPaths(home)),
        files: hermesDbPaths.length,
        exists: hermesDbPaths.length > 0,
      },
      {
        agent: "kilo",
        path: sourcePathLabel(kiloDbPaths, kiloRoots.map((root) => path.join(root, "kilo.db"))),
        files: kiloDbPaths.length,
        exists: kiloDbPaths.length > 0,
      },
      {
        agent: "openclaw",
        path: sourcePathLabel(openclawRoots, resolveOpenClawRoots(home)),
        files: openclawFiles.length,
        exists: openclawRoots.length > 0,
      },
      {
        agent: "pi",
        path: sourcePathLabel(piRoots, resolveDataDirs("PI_AGENT_DIR", home, ".pi/agent/sessions")),
        files: piFiles.length,
        exists: piRoots.length > 0,
      },
    ],
  };
}

async function readJsonlEvents(
  filePath: string,
  createParser: (options: { sourcePath: string }) => JsonlUsageParser,
): Promise<UsageEvent[]> {
  const parser = createParser({ sourcePath: filePath });
  await streamJsonlLines(filePath, (line) => parser.pushLine(line));
  return parser.finish();
}

async function streamJsonlLines(filePath: string, onLine: (line: string) => void): Promise<void> {
  let line = "";
  let skippingOverlongLine = false;

  for await (const chunk of createReadStream(filePath, { encoding: "utf8" })) {
    let start = 0;
    const text = String(chunk);

    while (start < text.length) {
      const newlineIndex = text.indexOf("\n", start);
      const end = newlineIndex === -1 ? text.length : newlineIndex;

      if (!skippingOverlongLine) {
        line += text.slice(start, end);
        if (line.length > MAX_JSONL_LINE_CHARS) {
          line = "";
          skippingOverlongLine = true;
        }
      }

      if (newlineIndex === -1) break;
      if (!skippingOverlongLine) onLine(stripTrailingCarriageReturn(line));
      line = "";
      skippingOverlongLine = false;
      start = newlineIndex + 1;
    }
  }

  if (!skippingOverlongLine && line) {
    onLine(stripTrailingCarriageReturn(line));
  }
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function resolveExplicitOpenCodeDbPath(home: string): string | null {
  const explicitDb = process.env.OPENCODE_DB?.trim();
  if (explicitDb) {
    if (path.isAbsolute(explicitDb)) return explicitDb;
    return path.join(resolveOpenCodeDataDirs(home)[0], explicitDb);
  }
  return null;
}

function resolveOpenCodeDataDirs(home: string): string[] {
  const explicitCcusage = process.env.OPENCODE_DATA_DIR?.trim();
  if (explicitCcusage) {
    return explicitCcusage
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const explicitHome = process.env.OPENCODE_HOME?.trim();
  if (explicitHome) {
    return explicitHome
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const xdgDataHome = process.env.XDG_DATA_HOME?.trim();
  if (xdgDataHome) return [path.join(xdgDataHome, "opencode")];
  return [path.join(home, ".local", "share", "opencode")];
}

async function discoverOpenCodeDbPaths(home: string, dataDirs: string[]): Promise<string[]> {
  const explicitDb = resolveExplicitOpenCodeDbPath(home);
  if (explicitDb) return existingFiles([explicitDb]);

  const candidates: string[] = [];
  for (const dataDir of dataDirs) {
    candidates.push(path.join(dataDir, "opencode.db"));
    const entries = await fs.readdir(dataDir, { withFileTypes: true }).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.isFile() && isOpenCodeChannelDbName(entry.name)) {
        candidates.push(path.join(dataDir, entry.name));
      }
    }
  }

  const existing = await existingFiles(candidates);
  existing.sort((a, b) => a.localeCompare(b));
  return [...new Set(existing)];
}

function isOpenCodeChannelDbName(name: string): boolean {
  if (!name.startsWith("opencode-") || !name.endsWith(".db")) return false;
  const channel = name.slice("opencode-".length, -".db".length);
  return Boolean(channel) && /^[A-Za-z0-9_-]+$/.test(channel);
}

function resolveCodebuffProjectRoots(home: string): string[] {
  const explicit = process.env.CODEBUFF_DATA_DIR?.trim();
  const roots = explicit
    ? explicit
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : ["manicode", "manicode-dev", "manicode-staging"].map((channel) => path.join(home, ".config", channel));
  return roots.map((root) => (path.basename(root) === "projects" ? root : path.join(root, "projects")));
}

function resolveGooseDbPaths(home: string): string[] {
  const explicitRoot = process.env.GOOSE_PATH_ROOT?.trim();
  if (explicitRoot) return [path.join(explicitRoot, "data", "sessions", "sessions.db")];
  return [
    path.join(home, ".local", "share", "goose", "sessions", "sessions.db"),
    path.join(home, "Library", "Application Support", "goose", "sessions", "sessions.db"),
    path.join(home, ".local", "share", "Block", "goose", "sessions", "sessions.db"),
  ];
}

function resolveHermesDbPaths(home: string): string[] {
  return resolveDataDirs("HERMES_HOME", home, ".hermes").map((root) => path.join(root, "state.db"));
}

function resolveOpenClawRoots(home: string): string[] {
  const explicit = process.env.OPENCLAW_DIR?.trim();
  if (explicit) {
    return explicit
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [".openclaw", ".clawdbot", ".moltbot", ".moldbot"].map((name) => path.join(home, name));
}

interface OpenCodeCollection {
  events: UsageEvent[];
  sourcePaths: string[];
}

async function readOpenCodeEvents(dbPaths: string[], messageFiles: string[]): Promise<OpenCodeCollection> {
  const events: UsageEvent[] = [];
  const sourcePaths = new Set<string>();
  const seenIds = new Set<string>();

  for (const dbPath of dbPaths) {
    for (const row of await readOpenCodeDbRows(dbPath)) {
      const event = parseOpenCodeMessageRow(row, dbPath);
      if (!event) continue;
      if (row.id && seenIds.has(row.id)) continue;
      if (row.id) seenIds.add(row.id);
      events.push(event);
      sourcePaths.add(dbPath);
    }
  }

  for (const file of messageFiles) {
    const fileStem = path.basename(file, ".json");
    if (fileStem && seenIds.has(fileStem)) continue;
    const row = await readOpenCodeMessageFile(file);
    if (!row) continue;
    const event = parseOpenCodeMessageRow(row, file);
    if (!event) continue;
    if (row.id && seenIds.has(row.id)) continue;
    if (row.id) seenIds.add(row.id);
    events.push(event);
    sourcePaths.add(file);
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { events, sourcePaths: [...sourcePaths].sort((a, b) => a.localeCompare(b)) };
}

async function readOpenCodeDbRows(dbPath: string): Promise<OpenCodeMessageRow[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", dbPath, openCodeMessageQuery()], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows: OpenCodeMessageRow[] = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as OpenCodeMessageRow);
  }
  return rows;
}

async function readOpenCodeMessageFile(filePath: string): Promise<OpenCodeMessageRow | null> {
  const data = await fs.readFile(filePath, "utf8");
  const value = JSON.parse(data) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id : path.basename(filePath, ".json"),
    session_id:
      typeof record.sessionID === "string" && record.sessionID.trim()
        ? record.sessionID
        : path.basename(path.dirname(filePath)),
    data,
  };
}

async function readGooseEvents(dbPath: string): Promise<UsageEvent[]> {
  const rows = await readSqliteJsonRows<GooseSessionRow>(dbPath, gooseSessionQuery());
  return rows.map((row) => parseGooseSessionRow(row, dbPath)).filter(isUsageEvent);
}

async function readHermesEvents(dbPath: string): Promise<UsageEvent[]> {
  const rows = await readSqliteJsonRows<HermesSessionRow>(dbPath, hermesSessionQuery());
  return rows.map((row) => parseHermesSessionRow(row, dbPath)).filter(isUsageEvent);
}

async function readKiloEvents(dbPath: string): Promise<UsageEvent[]> {
  const rows = await readSqliteJsonRows<KiloMessageRow>(dbPath, kiloMessageQuery());
  return rows.map((row) => parseKiloMessageRow(row, dbPath)).filter(isUsageEvent);
}

async function readSqliteJsonRows<T>(dbPath: string, query: string): Promise<T[]> {
  const { stdout } = await execFileAsync("sqlite3", ["-readonly", dbPath, query], {
    maxBuffer: 64 * 1024 * 1024,
  });
  const rows: T[] = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(JSON.parse(trimmed) as T);
  }
  return rows;
}

async function readKimiModelForWireFile(filePath: string): Promise<string | null> {
  const root = path.dirname(path.dirname(path.dirname(path.dirname(filePath))));
  const configPath = path.join(root, "config.json");
  const content = await fs.readFile(configPath, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return "";
    throw error;
  });
  if (!content) return null;
  const value = JSON.parse(content) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const model = (value as Record<string, unknown>).model;
  return typeof model === "string" && model.trim() ? model.trim() : null;
}

async function readDroidSidecarModel(settingsPath: string): Promise<string | null> {
  const prefix = path.basename(settingsPath).replace(/\.settings\.json$/, "");
  if (!prefix) return null;
  const sidecar = path.join(path.dirname(settingsPath), `${prefix}.jsonl`);
  const content = await fs.readFile(sidecar, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return "";
    throw error;
  });
  for (const line of content.split(/\r?\n/).slice(0, 500)) {
    const model = extractDroidModelFromLine(line);
    if (model) return model;
  }
  return null;
}

async function fileModifiedTimestamp(filePath: string): Promise<string | null> {
  const stat = await fs.stat(filePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  });
  return stat ? stat.mtime.toISOString() : null;
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

function gooseSessionQuery(): string {
  return [
    "SELECT json_object(",
    "'id', id,",
    "'model_config_json', model_config_json,",
    "'provider_name', provider_name,",
    "'created_at', created_at,",
    "'total_tokens', total_tokens,",
    "'input_tokens', input_tokens,",
    "'output_tokens', output_tokens,",
    "'accumulated_total_tokens', accumulated_total_tokens,",
    "'accumulated_input_tokens', accumulated_input_tokens,",
    "'accumulated_output_tokens', accumulated_output_tokens",
    ")",
    "FROM sessions",
    "WHERE model_config_json IS NOT NULL AND TRIM(model_config_json) != ''",
    "ORDER BY created_at ASC;",
  ].join(" ");
}

function hermesSessionQuery(): string {
  return [
    "SELECT json_object(",
    "'id', id,",
    "'model', model,",
    "'billing_provider', billing_provider,",
    "'started_at', started_at,",
    "'message_count', message_count,",
    "'input_tokens', input_tokens,",
    "'output_tokens', output_tokens,",
    "'cache_read_tokens', cache_read_tokens,",
    "'cache_write_tokens', cache_write_tokens,",
    "'reasoning_tokens', reasoning_tokens,",
    "'estimated_cost_usd', estimated_cost_usd,",
    "'actual_cost_usd', actual_cost_usd",
    ")",
    "FROM sessions",
    "WHERE model IS NOT NULL AND TRIM(model) != ''",
    "ORDER BY started_at ASC;",
  ].join(" ");
}

function kiloMessageQuery(): string {
  return [
    "SELECT json_object(",
    "'id', id,",
    "'session_id', session_id,",
    "'data', data",
    ")",
    "FROM message;",
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

async function listFilesForRoots(roots: string[], predicate: (filePath: string) => boolean): Promise<string[]> {
  const files = (
    await Promise.all(roots.map((root) => listFiles(root, predicate)))
  ).flat();
  files.sort((a, b) => a.localeCompare(b));
  return [...new Set(files)];
}

function resolveDataDirs(envName: string, home: string, defaultRelativeHomePath: string): string[] {
  const explicit = process.env[envName]?.trim();
  if (!explicit) return [path.join(home, defaultRelativeHomePath)];
  return explicit
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function existingDirs(candidates: string[]): Promise<string[]> {
  const existing = [];
  for (const candidate of candidates) {
    if (await isDirectory(candidate)) existing.push(candidate);
  }
  return existing;
}

async function existingFiles(candidates: string[]): Promise<string[]> {
  const existing = [];
  for (const candidate of candidates) {
    if (await isFile(candidate)) existing.push(candidate);
  }
  return existing;
}

async function isDirectory(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then((stat) => stat.isDirectory())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    });
}

async function isFile(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then((stat) => stat.isFile())
    .catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") return false;
      throw error;
    });
}

function sourcePathLabel(existing: string[], candidates: string[]): string {
  return (existing.length ? existing : candidates).join(",");
}

function isKimiWireFile(filePath: string): boolean {
  if (path.basename(filePath) !== "wire.jsonl") return false;
  const sessionDir = path.basename(path.dirname(filePath));
  const groupDir = path.basename(path.dirname(path.dirname(filePath)));
  const sessionsDir = path.basename(path.dirname(path.dirname(path.dirname(filePath))));
  return Boolean(sessionDir && groupDir && sessionsDir === "sessions");
}

function isQwenChatFile(filePath: string): boolean {
  return (
    filePath.endsWith(".jsonl") &&
    path.basename(path.dirname(filePath)) === "chats" &&
    path.basename(path.dirname(path.dirname(path.dirname(filePath)))) === "projects"
  );
}

function isCodebuffChatMessagesFile(filePath: string): boolean {
  return path.basename(filePath) === "chat-messages.json";
}

function isDroidSettingsFile(filePath: string): boolean {
  return path.basename(filePath).endsWith(".settings.json");
}

function isOpenClawSessionFile(filePath: string): boolean {
  const name = path.basename(filePath);
  const index = name.indexOf(".jsonl");
  if (index < 0) return false;
  const suffix = name.slice(index);
  return suffix === ".jsonl" || suffix.startsWith(".jsonl.deleted.") || suffix.startsWith(".jsonl.reset.");
}

function latestEventsBySession(events: UsageEvent[]): UsageEvent[] {
  const latest = new Map<string, UsageEvent>();
  for (const event of events) {
    const key = event.sessionId || event.sourcePath;
    const existing = latest.get(key);
    if (!existing || event.timestamp >= existing.timestamp) latest.set(key, event);
  }
  return [...latest.values()];
}

function isUsageEvent(event: UsageEvent | null): event is UsageEvent {
  return event !== null;
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
