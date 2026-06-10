import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createClaudeJsonlParser } from "./sources/claude.js";
import { createCodexJsonlParser } from "./sources/codex.js";
import { parseGeminiSession } from "./sources/gemini.js";
import { createKimiWireJsonlParser } from "./sources/kimi.js";
import { parseOpenCodeMessageRow, type OpenCodeMessageRow } from "./sources/opencode.js";
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
  const opencodeDbPath = resolveOpenCodeDbPath(home);
  const kimiRoots = await existingDirs(resolveDataDirs("KIMI_DATA_DIR", home, ".kimi"));
  const qwenRoots = await existingDirs(resolveDataDirs("QWEN_DATA_DIR", home, ".qwen"));

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
  const opencodeDbExists = await exists(opencodeDbPath);
  if (opencodeDbExists) {
    events.push(...(await readOpenCodeEvents(opencodeDbPath)));
  }

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
        path: opencodeDbPath,
        files: opencodeDbExists ? 1 : 0,
        exists: opencodeDbExists,
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

async function isDirectory(filePath: string): Promise<boolean> {
  return fs
    .stat(filePath)
    .then((stat) => stat.isDirectory())
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
