import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { readCollectionSnapshot } from "./collection-cache.js";
import { normalizeServerUrl, readConfig } from "./config.js";
import { collectCodexUsage } from "./file-scan.js";
import { readPricingCatalog } from "./server-pricing-catalog.js";
import { expandSourcePath, readSourceInput } from "./source-input.js";
import { initialCodexSessionRecord } from "./sources/codex-reader.js";
import type { UsageEvent } from "./types.js";
import { addUsdStrings, aggregateEvents } from "./usage-buckets.js";
import { usageRange } from "./usage-calendar.js";

interface SessionUsageOptions {
  days?: number;
  from?: string;
  to?: string;
  timeZone?: string;
}

interface ReportTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  unpricedTokens: number;
  costUsd: string | null;
}

interface SessionMetadata {
  sessionId: string | null;
  projectPath: string | null;
  parentSessionId: string | null;
  nickname: string | null;
}

interface SessionRow extends Omit<SessionMetadata, "nickname">, ReportTotals {
  title: string | null;
  models: string[];
  firstUsedAt: string;
  lastUsedAt: string;
}

interface ProjectRow extends ReportTotals {
  projectPath: string | null;
  sessionCount: number;
}

export interface SessionUsageReport {
  agent: "codex";
  from: string;
  to: string;
  timeZone: string;
  scannedAt: string;
  totals: ReportTotals;
  skippedLogs: number;
  sessions: SessionRow[];
  projects: ProjectRow[];
}

function emptyTotals(): ReportTotals {
  return { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0, unpricedTokens: 0, costUsd: null };
}

function addTotals(totals: ReportTotals, row: ReportTotals): void {
  totals.inputTokens += row.inputTokens;
  totals.cachedInputTokens += row.cachedInputTokens;
  totals.outputTokens += row.outputTokens;
  totals.reasoningOutputTokens += row.reasoningOutputTokens;
  totals.totalTokens += row.totalTokens;
  totals.unpricedTokens += row.unpricedTokens;
  totals.costUsd = addUsdStrings(totals.costUsd ?? undefined, row.costUsd ?? undefined) ?? null;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function sessionMetadata(file: string): Promise<SessionMetadata> {
  const row = await readSourceInput(file, () => initialCodexSessionRecord(file), null);
  const payload = record(row?.payload);
  const spawn = record(record(record(payload?.source)?.subagent)?.thread_spawn);
  return {
    sessionId: text(payload?.id) || text(payload?.session_id),
    projectPath: text(payload?.cwd),
    parentSessionId: text(payload?.parent_thread_id) || text(spawn?.parent_thread_id) || text(payload?.forked_from_id),
    nickname: text(payload?.agent_nickname) || text(spawn?.agent_nickname),
  };
}

async function readSessionTitles(file: string, signal?: AbortSignal): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  await readSourceInput(file, async () => {
    const input = createReadStream(file);
    const lines = createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        signal?.throwIfAborted();
        let row: Record<string, unknown> | undefined;
        try { row = record(JSON.parse(line)); } catch { continue; }
        const id = text(row?.id);
        const title = text(row?.thread_name);
        if (id && title) titles.set(id, title);
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }, undefined);
  return titles;
}

function byUsage(a: ReportTotals, b: ReportTotals): number {
  return Number(b.costUsd) - Number(a.costUsd) || b.totalTokens - a.totalTokens;
}

export async function readCodexSessionUsage(options: SessionUsageOptions = {}, signal?: AbortSignal): Promise<SessionUsageReport> {
  const home = process.env.TOKENFLOW_SCAN_HOME || os.homedir();
  const params = new URLSearchParams({ time_zone: options.timeZone || new Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (options.days !== undefined) {
    if (!Number.isInteger(options.days) || options.days < 1) throw new RangeError("Days must be a positive integer");
    params.set("days", String(options.days));
  }
  if (options.from !== undefined) params.set("from", options.from);
  if (options.to !== undefined) params.set("to", options.to);
  const { fromDate, toDate, timeZone, start, end } = usageRange(params, new Date(), 7);
  const codexHome = expandSourcePath(process.env.CODEX_HOME || path.join(home, ".codex"), home);
  const snapshot = await readCollectionSnapshot(home, codexHome);
  const { events, sources } = snapshot?.collection ?? await collectCodexUsage(home, codexHome, signal);
  signal?.throwIfAborted();
  const byFile = new Map<string, UsageEvent[]>();
  for (const event of events) {
    if (event.agent !== "codex") continue;
    const at = Date.parse(event.timestamp);
    if (!(at >= start && at <= end)) continue;
    const group = byFile.get(event.sourcePath) || [];
    group.push(event);
    byFile.set(event.sourcePath, group);
  }

  const report: SessionUsageReport = {
    agent: "codex", from: fromDate, to: toDate, timeZone, scannedAt: snapshot?.scannedAt ?? new Date().toISOString(), totals: emptyTotals(),
    skippedLogs: sources.find(source => source.agent === "codex")?.skippedFiles?.length ?? 0,
    sessions: [], projects: [],
  };
  if (!byFile.size) return report;

  const [titles, pricing] = await Promise.all([
    readSessionTitles(path.join(codexHome, "session_index.jsonl"), signal),
    readConfig().then(config => readPricingCatalog(normalizeServerUrl(config?.serverUrl))),
  ]);
  const profiles = [...(pricing?.profiles || []), ...(snapshot?.collection.pricingProfiles || [])];
  const groups = new Map<string, { metadata: SessionMetadata; events: UsageEvent[] }>();
  const files = [...byFile.keys()];
  for (let offset = 0; offset < files.length; offset += 16) {
    signal?.throwIfAborted();
    const batch = files.slice(offset, offset + 16);
    const metadata = await Promise.all(batch.map(sessionMetadata));
    for (const [index, file] of batch.entries()) {
      const usage = byFile.get(file)!;
      const info = metadata[index];
      info.sessionId ??= usage.find(event => event.sessionId)?.sessionId ?? null;
      const key = info.sessionId ? `session:${info.sessionId}` : `file:${file}`;
      const group = groups.get(key);
      if (group) {
        group.metadata.projectPath ??= info.projectPath;
        group.metadata.parentSessionId ??= info.parentSessionId;
        group.metadata.nickname ??= info.nickname;
        for (const event of usage) group.events.push(event);
      } else groups.set(key, { metadata: info, events: usage });
    }
  }

  const projects = new Map<string | null, ProjectRow>();
  for (const { metadata, events: usage } of groups.values()) {
    const { sessionId, projectPath, parentSessionId, nickname } = metadata;
    let first = Infinity, last = -Infinity;
    for (const event of usage) {
      const at = Date.parse(event.timestamp);
      first = Math.min(first, at);
      last = Math.max(last, at);
    }
    const row: SessionRow = {
      sessionId, projectPath, parentSessionId,
      title: (sessionId && titles.get(sessionId)) || nickname,
      models: [...new Set(usage.map(event => event.model))].sort(),
      firstUsedAt: new Date(first).toISOString(), lastUsedAt: new Date(last).toISOString(),
      ...emptyTotals(),
    };
    for (const bucket of aggregateEvents(usage, profiles)) {
      addTotals(row, {
        ...bucket,
        costUsd: bucket.pricingStatus === "priced" || bucket.recordedCostUsd !== undefined ? bucket.cost.totalUsd : null,
        unpricedTokens: bucket.pricingStatus === "unpriced" ? bucket.totalTokens - (bucket.recordedUsage?.totalTokens || 0) : 0,
      });
    }
    report.sessions.push(row);
    const project = projects.get(projectPath) || { projectPath, sessionCount: 0, ...emptyTotals() };
    project.sessionCount++;
    addTotals(project, row);
    projects.set(projectPath, project);
    addTotals(report.totals, row);
  }
  report.sessions.sort((a, b) => byUsage(a, b) || b.lastUsedAt.localeCompare(a.lastUsedAt));
  report.projects = [...projects.values()].sort(byUsage);
  return report;
}

export function formatSessionUsage(report: SessionUsageReport): string {
  const amount = (row: ReportTotals) => row.costUsd === null ? "—" : `$${row.costUsd}`;
  const tokens = (row: ReportTotals) => row.totalTokens.toLocaleString("en-US");
  const unpriced = (row: ReportTotals) => row.unpricedTokens ? ` · ${row.unpricedTokens.toLocaleString("en-US")} unpriced tokens` : "";
  const lines = [
    `Codex sessions on this device · ${report.from} to ${report.to} (${report.timeZone})`,
    `Last collection: ${report.scannedAt}`,
    `${report.sessions.length} sessions · ${tokens(report.totals)} tokens · ${amount(report.totals)} estimated${unpriced(report.totals)}`,
  ];
  if (report.skippedLogs) lines.push(`Logs with skipped records: ${report.skippedLogs}`);
  if (!report.sessions.length) return [...lines, "No recorded Codex usage in this range.", ""].join("\n");
  lines.push("", "Projects");
  for (const project of report.projects) {
    lines.push(`  ${amount(project)} · ${tokens(project)} tokens · ${project.sessionCount} sessions · ${JSON.stringify(project.projectPath ?? "Unknown project")}${unpriced(project)}`);
  }
  lines.push("", "Sessions");
  for (const session of report.sessions) {
    const title = session.title ? ` ${JSON.stringify(session.title)}` : "";
    const parent = session.parentSessionId ? ` · parent ${JSON.stringify(session.parentSessionId)}` : "";
    lines.push(`  ${amount(session)} · ${tokens(session)} tokens · ${JSON.stringify(session.sessionId ?? "Unknown session ID")}${title} · ${JSON.stringify(session.projectPath ?? "Unknown project")}${parent}${unpriced(session)}`);
  }
  return [...lines, ""].join("\n");
}
