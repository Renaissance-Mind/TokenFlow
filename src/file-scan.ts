import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parseClaudeJsonl } from "./sources/claude.js";
import { parseCodexJsonl } from "./sources/codex.js";
import { parseGeminiSession } from "./sources/gemini.js";
import type { UsageEvent } from "./types.js";

export interface SourceStatus {
  agent: string;
  path: string;
  files: number;
  exists: boolean;
}

export interface CollectionResult {
  events: UsageEvent[];
  sources: SourceStatus[];
}

export async function collectLocalUsage(home = os.homedir()): Promise<CollectionResult> {
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const claudeHome = process.env.CLAUDE_HOME || path.join(home, ".claude");
  const geminiHome = process.env.GEMINI_HOME || path.join(home, ".gemini");

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

  return {
    events,
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
    ],
  };
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
