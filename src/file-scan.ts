import { cachedSource, withCollectionCache, collectionRevision } from "./collection-cache.js";
import { readIncrementalJsonl, type CheckpointParser } from "./incremental-jsonl.js";
import { appendItems } from "./arrays.js";
import { ScanTracker, withScanTracker, scanFile, discoveredFile, scannedBytes, type ScanProgress } from "./scan-progress.js";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse as parseToml } from "smol-toml";

import { parseAmpThread } from "./sources/amp.js";
import { createClaudeJsonlParser } from "./sources/claude.js";
import { createCodexJsonlParser, type CodexCheckpoint } from "./sources/codex.js";
import { dedupeCodexSessions, type CodexSession } from "./sources/codex-replay.js";
import { sqliteRows, tableColumns } from "./sources/store-io.js";
import { codexRolloutLines, isCodexRollout, plainRolloutPath } from "./sources/codex-reader.js";
import { parseCodebuffChatMessages } from "./sources/codebuff.js";
import { extractDroidModelFromLine, parseDroidSettings } from "./sources/droid.js";
import { planDshUsage, resolveDshSessionDirs } from "./sources/dsh.js";
import { planGrok } from "./sources/grok.js";
import { planZcode } from "./sources/zcode.js";
import { planAntigravity } from "./sources/antigravity.js";
import { planCopilot } from "./sources/copilot.js";
import { parseGeminiSession, createGeminiJsonlParser } from "./sources/gemini.js";
import { parseGooseSessionRow, type GooseSessionRow } from "./sources/goose.js";
import { parseHermesSessionRow, type HermesSessionRow } from "./sources/hermes.js";
import { parseKiloMessageRow, type KiloMessageRow } from "./sources/kilo.js";
import { createKimiWireJsonlParser } from "./sources/kimi.js";
import { parseOpenCodeMessageRow, type OpenCodeMessageRow } from "./sources/opencode.js";
import { createOpenClawJsonlParser, planOpenClawDatabases, mergeOpenClawStores } from "./sources/openclaw.js";
import { planPiStores } from "./sources/pi.js";
import { createQwenChatJsonlParser } from "./sources/qwen.js";
import type { PricingProfile, UsageEvent } from "./types.js";

const MAX_JSONL_LINE_CHARS = 16 * 1024 * 1024;

interface JsonlUsageParser {
  pushLine(line: string): void;
  finish(): UsageEvent[];
  snapshot?(): unknown;
}

export interface SourceStatus {
  agent: string;
  path: string;
  files: number;
  exists: boolean;
}

export interface CollectionResult {
  revision?: string;
  scannedFiles?: string[];
  events: UsageEvent[];
  pricingProfiles: PricingProfile[];
  sources: SourceStatus[];
}

export async function collectLocalUsage(home = process.env.TOKENFLOW_SCAN_HOME || os.homedir(), onProgress?: (progress: ScanProgress) => void, signal?: AbortSignal): Promise<CollectionResult> {
  const tracker = onProgress ? new ScanTracker(onProgress) : undefined;
  return withCollectionCache(home, async () => ({ ...await withScanTracker(tracker, () => collectUsage(home, tracker)), revision: collectionRevision() }), signal);
}

async function collectUsage(
  home: string,
  tracker?: ScanTracker,
): Promise<CollectionResult> {
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const claudeHome = process.env.CLAUDE_HOME || path.join(home, ".claude");
  const geminiHome = process.env.GEMINI_HOME || path.join(home, ".gemini");
  const geminiRoots = process.env.GEMINI_DATA_DIR?.trim()
    ? process.env.GEMINI_DATA_DIR.split(",")
        .map((root) => root.trim())
        .filter(Boolean)
    : [path.join(geminiHome, "tmp")];
  const opencodeDataDirs = await existingDirs(resolveOpenCodeDataDirs(home));
  const opencodeDbPaths = await discoverOpenCodeDbPaths(home, opencodeDataDirs);
  const kimiCandidates = process.env.KIMI_DATA_DIR?.trim()
    ? resolveDataDirs("KIMI_DATA_DIR", home, ".kimi")
    : [path.join(home, ".kimi"), path.join(home, ".kimi-code")];
  const kimiRoots = await existingDirs(kimiCandidates);
  const qwenRoots = await existingDirs(
    resolveDataDirs("QWEN_DATA_DIR", home, ".qwen"),
  );
  const ampRoots = await existingDirs(
    resolveDataDirs("AMP_DATA_DIR", home, ".local/share/amp"),
  );
  const codebuffProjectRoots = await existingDirs(
    resolveCodebuffProjectRoots(home),
  );
  const droidRoots = await existingDirs(
    resolveDataDirs("DROID_SESSIONS_DIR", home, ".factory/sessions"),
  );
  const gooseDbPaths = await existingFiles(resolveGooseDbPaths(home));
  const hermesDbPaths = await existingFiles(resolveHermesDbPaths(home));
  const kiloRoots = await existingDirs(
    resolveDataDirs("KILO_DATA_DIR", home, ".local/share/kilo"),
  );
  const openclawRoots = await existingDirs(resolveOpenClawRoots(home));
  const piRoots = await existingDirs(
    resolveDataDirs("PI_AGENT_DIR", home, ".pi/agent/sessions"),
  );
  const codexServiceTier = await readCodexServiceTier(codexHome);
  const dshPlan = await planDshUsage(resolveDshSessionDirs(home));
  const additionalPlans = await Promise.all([
    planGrok(home),
    planZcode(home),
    planAntigravity(home),
    planCopilot(home),
  ]);
  const codexFiles: string[] = [];
  const seenRollouts = new Set<string>();
  for (const name of ["sessions", "archived_sessions"]) {
    const root = path.join(codexHome, name);
    for (const file of (await listFiles(root, isCodexRollout)).sort()) {
      const key = plainRolloutPath(path.relative(root, file));
      if (seenRollouts.has(key)) continue;
      seenRollouts.add(key); codexFiles.push(file);
    }
  }
  const claudeFiles = await listFiles(
    path.join(claudeHome, "projects"),
    (file) => file.endsWith(".jsonl"),
  );
  const geminiFiles = await listFilesForRoots(
    geminiRoots,
    (file) => file.endsWith(".json") || file.endsWith(".jsonl"),
  );
  const kimiFiles = await listFilesForRoots(
    kimiRoots.map((root) => path.join(root, "sessions")),
    isKimiWireFile,
  );
  const qwenFiles = await listFilesForRoots(
    qwenRoots.map((root) => path.join(root, "projects")),
    isQwenChatFile,
  );
  const ampFiles = await listFilesForRoots(
    ampRoots.map((root) => path.join(root, "threads")),
    (file) => file.endsWith(".json"),
  );
  const codebuffFiles = await listFilesForRoots(
    codebuffProjectRoots,
    isCodebuffChatMessagesFile,
  );
  const droidFiles = await listFilesForRoots(droidRoots, isDroidSettingsFile);
  const kiloDbPaths = await existingFiles(
    kiloRoots.map((root) => path.join(root, "kilo.db")),
  );
  const openclawFiles = await listFilesForRoots(
    openclawRoots,
    isOpenClawSessionFile,
  );
  const opencodeMessageFiles = await listFilesForRoots(
    opencodeDataDirs.map((root) => path.join(root, "storage", "message")),
    (file) => file.endsWith(".json"),
  );
  const openclawPlan = await planOpenClawDatabases(openclawRoots);
  const piPlan = await planPiStores(home, piRoots);
  const allFiles = [
    ...codexFiles,
    ...claudeFiles,
    ...geminiFiles,
    ...kimiFiles,
    ...qwenFiles,
    ...ampFiles,
    ...codebuffFiles,
    ...droidFiles,
    ...gooseDbPaths,
    ...hermesDbPaths,
    ...kiloDbPaths,
    ...openclawFiles,
    ...opencodeDbPaths,
    ...opencodeMessageFiles,
    ...dshPlan.files,
    ...openclawPlan.files,
    ...piPlan.files,
    ...additionalPlans.flatMap((plan) => plan.files),
  ];
  await tracker?.begin(allFiles);
  const dependencies = [...new Set([
    ...allFiles,
    ...allFiles.filter(file => /\.(?:db|sqlite|sqlite3|vscdb)$/.test(file)).map(file => file + "-wal"),
    path.join(codexHome, "config.toml"), path.join(codexHome, "sessions"), path.join(codexHome, "archived_sessions"),
    path.join(claudeHome, "projects"), ...geminiRoots, ...kimiCandidates, ...qwenRoots, ...ampRoots,
    ...codebuffProjectRoots, ...droidRoots, ...openclawRoots, ...piRoots, ...resolveDshSessionDirs(home),
    ...kimiCandidates.map(root => path.join(root, "config.json")),
    ...droidFiles.map(file => file.replace(/\.settings\.json$/, ".jsonl")),
    ...additionalPlans[0].files.map(file => path.join(path.dirname(file), "summary.json")),
    path.join(process.cwd(), ".ccusage/ccusage.json"), path.join(home, ".config/claude/ccusage.json"), path.join(home, ".claude/ccusage.json"),
  ])].sort();
  const result = await cachedSource("collection-result", dependencies, async () => {
    const dsh = await dshPlan.collect();
    const additional = await Promise.all(
      additionalPlans.map((plan) => plan.collect()),
    );
    const events: UsageEvent[] = [];
    appendItems(events, dsh.events);
    for (const source of additional) appendItems(events, source.events);
    const codexSessions: CodexSession[] = [];
    for (const file of codexFiles) {
      const result = await scanFile(file, () => cachedSource("codex-session", [file], async () => {
        const create = (saved?: unknown) => createCodexJsonlParser({ sourcePath: plainRolloutPath(file), serviceTier: codexServiceTier,
          compactionHistory: new Map(), useReplayPlan: true }, saved);
        let result: { events: UsageEvent[]; state: unknown };
        if (file.endsWith(".jsonl") && await fs.access(file).then(() => true, () => false)) {
          result = await readIncrementalJsonl(file, create, codexServiceTier);
        } else {
          const parser = create();
          for await (const line of codexRolloutLines(file, bytes => scannedBytes(file, bytes))) parser.pushLine(line);
          const state = parser.snapshot();
          result = { events: parser.finish(), state };
        }
        const state = result.state as CodexCheckpoint;
        return { ...state.session || { id: plainRolloutPath(file) }, events: result.events,
          compactions: state.compactions.filter(([id]) => state.compacted.includes(id)) };
      }, codexServiceTier));
      codexSessions.push({ ...result, compactions: new Map(result.compactions) });
    }
    appendItems(events, dedupeCodexSessions(codexSessions));
    for (const file of claudeFiles) {
      appendItems(events, await scanFile(file, () => readJsonlEvents(file, createClaudeJsonlParser)));
    }
    for (const file of geminiFiles) {
      appendItems(events, await scanFile(file, () => cachedSource("gemini", [file], async () => {
        const fallbackTimestamp = (await fileModifiedTimestamp(file)) || undefined;
        return file.endsWith(".jsonl")
          ? readJsonlEvents(file, (options, saved) => createGeminiJsonlParser({ ...options, fallbackTimestamp }, saved))
          : parseGeminiSession(await readUsageText(file), { sourcePath: file, fallbackTimestamp });
      })));
    }
    for (const file of kimiFiles) {
      const parts = file.split(path.sep);
      const config = path.join(parts.slice(0, parts.lastIndexOf("sessions")).join(path.sep) || path.sep, "config.json");
      appendItems(events, await scanFile(file, () => cachedSource("kimi", [file, config], async () => {
        const model = await readKimiModelForWireFile(file);
        const fallbackTimestamp = (await fileModifiedTimestamp(file)) || undefined;
        return readJsonlEvents(file, (options, saved) => createKimiWireJsonlParser({ ...options, model, fallbackTimestamp }, saved), model);
      })));
    }
    for (const file of qwenFiles) appendItems(events, await scanFile(file, () => readJsonlEvents(file, createQwenChatJsonlParser)));
    for (const file of ampFiles) appendItems(events, await scanFile(file, () => cachedSource("amp", [file], async () => parseAmpThread(await readUsageText(file), { sourcePath: file }))));
    for (const file of codebuffFiles) appendItems(events, await scanFile(file, () => cachedSource("codebuff", [file], async () => parseCodebuffChatMessages(await readUsageText(file), { sourcePath: file }))));
    const droidEvents: UsageEvent[] = [];
    for (const file of droidFiles) {
      const result = await scanFile(file, () => cachedSource("droid", [file, file.replace(/\.settings\.json$/, ".jsonl")], async () =>
        parseDroidSettings(await readUsageText(file), { sourcePath: file, sidecarModel: await readDroidSidecarModel(file), fallbackTimestamp: await fileModifiedTimestamp(file) })));
      if (result) droidEvents.push(result);
    }
    appendItems(events, latestEventsBySession(droidEvents));
    for (const dbPath of gooseDbPaths) appendItems(events, await scanFile(dbPath, () => cachedSource("goose", [dbPath, dbPath + "-wal"], () => readGooseEvents(dbPath))));
    for (const dbPath of hermesDbPaths) appendItems(events, await scanFile(dbPath, () => cachedSource("hermes", [dbPath, dbPath + "-wal"], () => readHermesEvents(dbPath))));
    for (const dbPath of kiloDbPaths) appendItems(events, await scanFile(dbPath, () => cachedSource("kilo", [dbPath, dbPath + "-wal"], () => readKiloEvents(dbPath))));
    const openclawEvents: UsageEvent[] = [];
    for (const file of openclawFiles) appendItems(openclawEvents, await scanFile(file, () => cachedSource("openclaw-jsonl", [file], async () => {
      const fallbackTimestamp = await fileModifiedTimestamp(file);
      return readJsonlEvents(file, (options, saved) => createOpenClawJsonlParser({ ...options, fallbackTimestamp }, saved));
    })));
    const openclawDatabase = await openclawPlan.collect();
    appendItems(events, mergeOpenClawStores(openclawEvents, openclawDatabase.events));
    const piStores = await piPlan.collect();
    appendItems(events, piStores.events);
    const opencodeEvents = await readOpenCodeEvents(
      opencodeDbPaths,
      opencodeMessageFiles,
    );
    appendItems(events, opencodeEvents.events);
    return {
      events: dedupeTranscriptEvents(events),
      pricingProfiles: [],
      sources: [
        ...additional.map((source) => source.source),
        ...piStores.sources.filter((source) => source.agent !== "pi"),
        {
          agent: "dsh",
          path: sourcePathLabel(dsh.roots, resolveDshSessionDirs(home)),
          files: dsh.files.length,
          exists: dsh.roots.length > 0,
        },
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
          path: geminiRoots.join(","),
          files: geminiFiles.length,
          exists: await exists(path.join(geminiHome, "tmp")),
        },
        {
          agent: "opencode",
          path: sourcePathLabel(
            opencodeEvents.sourcePaths,
            resolveOpenCodeDataDirs(home),
          ),
          files: opencodeEvents.sourcePaths.length,
          exists: opencodeEvents.sourcePaths.length > 0,
        },
        {
          agent: "kimi",
          path: sourcePathLabel(kimiRoots, kimiCandidates),
          files: kimiFiles.length,
          exists: kimiRoots.length > 0,
        },
        {
          agent: "qwen",
          path: sourcePathLabel(
            qwenRoots,
            resolveDataDirs("QWEN_DATA_DIR", home, ".qwen"),
          ),
          files: qwenFiles.length,
          exists: qwenRoots.length > 0,
        },
        {
          agent: "amp",
          path: sourcePathLabel(
            ampRoots,
            resolveDataDirs("AMP_DATA_DIR", home, ".local/share/amp"),
          ),
          files: ampFiles.length,
          exists: ampRoots.length > 0,
        },
        {
          agent: "codebuff",
          path: sourcePathLabel(
            codebuffProjectRoots,
            resolveCodebuffProjectRoots(home),
          ),
          files: codebuffFiles.length,
          exists: codebuffProjectRoots.length > 0,
        },
        {
          agent: "droid",
          path: sourcePathLabel(
            droidRoots,
            resolveDataDirs("DROID_SESSIONS_DIR", home, ".factory/sessions"),
          ),
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
          path: sourcePathLabel(
            kiloDbPaths,
            kiloRoots.map((root) => path.join(root, "kilo.db")),
          ),
          files: kiloDbPaths.length,
          exists: kiloDbPaths.length > 0,
        },
        {
          agent: "openclaw",
          path: sourcePathLabel(openclawRoots, resolveOpenClawRoots(home)),
          files: openclawFiles.length + openclawDatabase.files.length,
          exists: openclawRoots.length > 0,
        },
        {
          agent: "pi",
          path:
            piStores.sources.find((source) => source.agent === "pi")?.path ||
            sourcePathLabel(
              piRoots,
              resolveDataDirs("PI_AGENT_DIR", home, ".pi/agent/sessions"),
            ),
          files:
            piStores.sources.find((source) => source.agent === "pi")?.files || 0,
          exists:
            piStores.sources.find((source) => source.agent === "pi")?.exists ||
            false,
        },
      ],
    };
  }, { home, codexHome, claudeHome, geminiHome, codexServiceTier });
  for (const file of allFiles) tracker?.complete(file);
  tracker?.processing();
  return { ...result, scannedFiles: allFiles };
}

async function readCodexServiceTier(codexHome: string): Promise<"standard" | "fast" | "priority" | "flex"> {
  const configPath = path.join(codexHome, "config.toml");
  const config = await fs.readFile(configPath, "utf8").catch(() => "");
  const tier = codexServiceTierFromConfig(config);
  return tier || "standard";
}

export function codexServiceTierFromConfig(content: string): "standard" | "fast" | "priority" | "flex" | null {
  let config: Record<string, unknown>;
  try { config = parseToml(content); } catch { return null; }
  const profiles = config.profiles as Record<string, { service_tier?: unknown }> | undefined;
  const value = (typeof config.profile === "string" ? profiles?.[config.profile]?.service_tier : undefined) ?? config.service_tier;
  if (value === "default" || value === "standard") return "standard";
  return value === "fast" || value === "priority" || value === "flex" ? value : null;
}

async function readJsonlEvents(
  filePath: string,
  createParser: (options: { sourcePath: string }, saved?: unknown) => JsonlUsageParser,
  settings: unknown = null,
): Promise<UsageEvent[]> {
  const parser = createParser({ sourcePath: filePath });
  if (parser.snapshot) return (await readIncrementalJsonl(filePath, saved => createParser({ sourcePath: filePath }, saved) as CheckpointParser, settings)).events;
  return cachedSource("jsonl-events", [filePath], async () => {
    await streamJsonlLines(filePath, line => parser.pushLine(line));
    return parser.finish();
  }, settings);
}

async function streamJsonlLines(filePath: string, onLine: (line: string) => void): Promise<void> {
  let line = "";
  let skippingOverlongLine = false;

  const stream = createReadStream(filePath, { encoding: "utf8" });
  for await (const chunk of stream) {
    let start = 0;
    const text = String(chunk);
    scannedBytes(filePath, stream.bytesRead);

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
  const events: UsageEvent[] = [], aggregates: UsageEvent[] = [];
  const seenIds = new Set<string>(), sourcePaths = new Set<string>();
  for (const file of [...dbPaths, ...messageFiles]) {
    const database = dbPaths.includes(file);
    const entries = await scanFile(file, () => cachedSource("opencode", database ? [file, file + "-wal"] : [file], async () => {
      const rows = database ? await readOpenCodeDbRows(file) : [await readOpenCodeMessageFile(file)];
      return rows.flatMap(row => {
        const event = row && parseOpenCodeMessageRow(row, file);
        return row && event ? [{ event, id: row.id, aggregate: !!row.aggregate }] : [];
      });
    }));
    for (const entry of entries) {
      if (entry.aggregate) { aggregates.push(entry.event); continue; }
      if (entry.id && seenIds.has(entry.id)) continue;
      if (entry.id) seenIds.add(entry.id);
      events.push(entry.event); sourcePaths.add(file);
    }
  }
  const covered = new Set(events.map(event => event.sessionId));
  for (const event of aggregates) if (!covered.has(event.sessionId)) {
    events.push(event); sourcePaths.add(event.sourcePath); covered.add(event.sessionId);
  }
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return { events, sourcePaths: [...sourcePaths].sort() };
}

async function readOpenCodeDbRows(dbPath: string): Promise<OpenCodeMessageRow[]> {
  const rows: OpenCodeMessageRow[] = [];
  if ((await tableColumns(dbPath, "message")).has("data")) {
    appendItems(rows, await readSqliteJsonRows<OpenCodeMessageRow>(dbPath, openCodeMessageQuery()));
  }
  const v2 = await tableColumns(dbPath, "session_message");
  const sessions = await tableColumns(dbPath, "session_v2");
  if (["id", "session_id", "data", "type"].every((column) => v2.has(column))) {
    const messages = await sqliteRows<OpenCodeMessageRow & { type: string; seq?: number }>(dbPath,
      `SELECT id,session_id,data,type,${v2.has("seq") ? "seq" : "NULL AS seq"},${v2.has("time_created") ? "time_created" : "NULL AS time_created"} FROM session_message;`);
    const cutoffs = new Map<string, number>();
    if (v2.has("seq") && ["id", "fork_session_id", "fork_boundary"].every((column) => sessions.has(column))) {
      for (const fork of await sqliteRows<{ id: string; fork_session_id: string; fork_boundary: string }>(dbPath,
        "SELECT id,fork_session_id,fork_boundary FROM session_v2 WHERE fork_session_id IS NOT NULL AND fork_boundary IS NOT NULL;")) {
        let boundary: { type?: string; messageID?: string };
        try { boundary = JSON.parse(fork.fork_boundary); } catch { continue; }
        const parent = messages.filter((row) => row.session_id === fork.fork_session_id);
        const at = parent.find((row) => row.id === boundary.messageID)?.seq;
        if (at === undefined || at === null) continue;
        if (boundary.type === "through") cutoffs.set(fork.id, at);
        else if (boundary.type === "before") {
          const preceding = parent.map((row) => row.seq).filter((seq): seq is number => typeof seq === "number" && seq < at);
          if (preceding.length) cutoffs.set(fork.id, Math.max(...preceding));
        }
      }
    }
    appendItems(rows, messages.filter((row) => row.type === "assistant" && !(row.seq !== undefined && row.seq !== null && cutoffs.has(row.session_id) && row.seq <= cutoffs.get(row.session_id)!)));
  }
  for (const table of ["session_v2", "session"]) {
    const columns = await tableColumns(dbPath, table);
    if (!["id", "time_created", "tokens_input", "tokens_output", "tokens_cache_read", "tokens_cache_write"].every((column) => columns.has(column))) continue;
    const totals = await sqliteRows<Record<string, unknown>>(dbPath, `SELECT id,time_created,tokens_input,tokens_output,tokens_cache_read,tokens_cache_write,
      ${columns.has("model") ? "model" : "NULL AS model"},${columns.has("cost") ? "cost" : "NULL AS cost"},${columns.has("tokens_reasoning") ? "tokens_reasoning" : "0 AS tokens_reasoning"} FROM ${table};`);
    for (const row of totals) {
      let model: unknown = row.model || "unknown";
      if (typeof model === "string" && /^[{"[]/.test(model)) { try { model = JSON.parse(model); } catch { /* Plain model names remain valid. */ } }
      rows.push({ id: `session:${row.id}`, session_id: String(row.id), time_created: Number(row.time_created), aggregate: true,
        data: JSON.stringify({ model, cost: row.cost, tokens: { input: row.tokens_input, output: row.tokens_output,
          reasoning: row.tokens_reasoning, cache: { read: row.tokens_cache_read, write: row.tokens_cache_write } } }) });
    }
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
  const rows = await sqliteRows<Record<string, string>>(dbPath, query);
  return rows.map((row) => JSON.parse(Object.values(row)[0]) as T);
}

async function readKimiModelForWireFile(filePath: string): Promise<string | null> {
  const parts = filePath.split(path.sep);
  const root = parts.slice(0, parts.lastIndexOf("sessions")).join(path.sep) || path.sep;
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
  const parts = filePath.split(path.sep);
  const index = parts.lastIndexOf("sessions");
  const length = parts.length - index - 1;
  return index >= 0 && (length === 3 || (length === 5 && parts[index + 3] === "agents"));
}

function isQwenChatFile(filePath: string): boolean {
  return filePath.endsWith(".jsonl");
}

function dedupeTranscriptEvents(events: UsageEvent[]): UsageEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (!["kimi", "qwen", "gemini", "claude"].includes(event.agent)) return true;
    const key = event.messageId ? `${event.agent}|${event.agent === "claude" ? "" : event.sessionId}|${event.messageId}`
      : [event.agent,event.sessionId,event.timestamp,event.model,event.inputTokens,event.outputTokens,event.cachedInputTokens,event.cacheCreationTokens,event.reasoningOutputTokens,event.totalTokens].join("|");
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
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
      output.push(entryPath); discoveredFile(entryPath);
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

async function readUsageText(file: string): Promise<string> {
  const raw = await fs.readFile(file, "utf8");
  scannedBytes(file, Buffer.byteLength(raw));
  return raw;
}
