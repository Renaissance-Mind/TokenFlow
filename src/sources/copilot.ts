import { expandSourcePath, reportSourceIssue } from "../source-input.js";
import { readIncrementalJsonl, type CheckpointParser } from "../incremental-jsonl.js";
import { cachedSource } from "../collection-cache.js";
import { appendItems } from "../arrays.js";
import { scanFile, discoveredFile, scannedBytes } from "../scan-progress.js";
import fs from "node:fs/promises";
import path from "node:path";
import { isRecord, makeUsageEvent, recordField, stringField } from "./ccusage-common.js";
import { nonNegativeInt } from "../token-totals.js";
import { storeFiles } from "./store-io.js";
import type { UsageEvent } from "../types.js";
import { toUtcHalfHourStart } from "../time.js";

interface Entry { event: UsageEvent; key: string; requests: number; credits: number | null; rank?: number; trace?: string; response?: string; serviceRequest?: string; sourceSession?: string; sequence?: number; reasoning?: number; }
interface Credit { session: string; time: string; shutdown: boolean; total: number | null; key: string; file: string; watermark?: number; }
interface CopilotState { entries: Entry[]; credits: Credit[]; records: Entry[]; covered: boolean; unproven?: boolean; index: number; rows: Record<string, unknown>[]; }
const normalizeModel = (model: string) => model.trim().replace(/-1m(?:-internal)?$/, "");
const time = (event: UsageEvent) => Date.parse(event.timestamp);
const pair = (event: UsageEvent) => JSON.stringify([event.sessionId, event.pricingModel || event.model]);
const numeric = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(Math.round(value)) && value >= 0 ? Math.round(value) : null;
function creditsToUsd(nano: number): string {
  const amount = BigInt(nano), scale = 100_000_000_000n;
  const fraction = (amount % scale).toString().padStart(11, "0").replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}
function telemetryProjection(row: Record<string, unknown>): Record<string, unknown> {
  const attributes = recordField(row, "attributes") || {};
  const safe = Object.fromEntries(Object.entries(attributes).filter(([key, value]) =>
    (/^gen_ai\.(usage\.|conversation\.id$|response\.(id|model)$|request\.model$|operation\.name$)/.test(key)
      || ["copilot_chat.session_id", "copilot_chat.chat_session_id", "session.id", "github.copilot.interaction_id", "github.copilot.service_request_id", "event.name"].includes(key))
      && ["number", "string", "boolean"].includes(typeof value)));
  const context = recordField(row, "spanContext");
  const name = String(row.name || ""), body = String(row.body || row._body || "");
  const projected: Record<string, unknown> = { attributes: safe,
    type: row.type ? row.type === "span" ? "span" : "log" : undefined,
    name: name.startsWith("chat ") ? "chat " : name.startsWith("invoke_agent ") ? "invoke_agent " : name ? "other" : undefined,
    body: body.startsWith("GenAI inference:") ? "GenAI inference:" : body.startsWith("copilot_chat.agent.turn") ? "copilot_chat.agent.turn" : "",
    traceId: stringField(row, "traceId") || undefined, spanId: stringField(row, "spanId") || undefined,
    spanContext: context ? {traceId:stringField(context,"traceId"),spanId:stringField(context,"spanId")} : undefined,
    kind: !!row.kind, duration: !!row.duration };
  for (const key of ["endTime", "startTime", "hrTime", "_hrTime", "time", "timestamp", "observedTimestamp", "timeUnixNano"]) {
    if (Array.isArray(row[key])) projected[key] = (row[key] as unknown[]).map(Number);
    else if (Number.isFinite(Number(row[key])) || typeof row[key] === "string" && Number.isFinite(Date.parse(String(row[key])))) projected[key] = row[key];
  }
  return projected;
}
function copilotParser(file: string, telemetry: boolean, saved?: unknown): CheckpointParser {
  const state = (saved || {entries:[],credits:[],records:[],covered:false,index:0,rows:[]}) as CopilotState;
  return {
    pushLine(line) {
      let row: unknown;
      try { row = JSON.parse(line); } catch (error) { if (error instanceof SyntaxError) return; throw error; }
      if (!isRecord(row)) return;
      if (telemetry) state.rows.push(telemetryProjection(row));
      else nativeRow(row, file, state);
    },
    snapshot: () => state,
    finish: () => [],
  };
}

function nativeRow(row: Record<string, unknown>, file: string, state: CopilotState): void {
  const session = path.basename(path.dirname(file));
  const data = recordField(row, "data") || {};
  const timestamp = stringField(row, "timestamp");
  if (row.type === "session.usage_record") {
    const usage = recordField(data, "usage");
    const model = stringField(usage, "model");
    if (!usage || !model) return;
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) { reportSourceIssue(file, "invalid usage timestamp"); return; }
    state.covered = true;
    const accounting = recordField(usage, "accounting");
    const sourceSession = stringField(accounting, "sourceSessionId") || undefined;
    const sequence = accounting?.sequence;
    const identity = sourceSession && typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0 ? [sourceSession, sequence] : [session, stringField(row, "id") || state.index];
    state.unproven ||= !sourceSession || sourceSession !== session;
    state.index++;
    const cached = nonNegativeInt(usage.cacheReadTokens), created = nonNegativeInt(usage.cacheWriteTokens);
    const parts = { agent: "copilot" as const, model: normalizeModel(model), sessionId: session, sourcePath: file, timestamp,
      inputTokens: Math.max(0, nonNegativeInt(usage.inputTokens) - cached - created), cachedInputTokens: cached, cacheCreationTokens: created,
      outputTokens: nonNegativeInt(usage.outputTokens) };
    const event = makeUsageEvent(parts) || { ...parts, reasoningOutputTokens: 0, totalTokens: 0, bucketStart: toUtcHalfHourStart(timestamp)! };
    state.records.push({ event, key: JSON.stringify(["usage-record", ...identity]), requests: 1,
      credits: numeric(recordField(usage, "copilotUsage")?.totalNanoAiu), sourceSession, ...(typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0 ? { sequence } : {}),
      response: stringField(usage, "apiCallId") || undefined, serviceRequest: stringField(usage, "serviceRequestId") || undefined });
    return;
  }
  const shutdown = row.type === "session.shutdown";
  if (!shutdown && row.type !== "session.usage_checkpoint") return;
  const watermarks = recordField(data, "usageAccountingWatermarks") || {};
  const local = watermarks[session];
  const watermark = typeof local === "number" && Number.isSafeInteger(local) && local > 0
    && Object.entries(watermarks).every(([source, sequence]) => source === session || sequence === 0) ? local : undefined;
  if (Object.values(watermarks).some(value => typeof value === "number" && Number.isSafeInteger(value) && value > 0)) state.covered = true;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
    if (state.covered) state.unproven = true;
    if (state.covered || data.totalNanoAiu !== undefined || recordField(data, "modelMetrics")) reportSourceIssue(file, "invalid usage timestamp");
    return;
  }
  const key = JSON.stringify([session, row.id || [timestamp, shutdown, data.totalNanoAiu]]);
  if (state.covered && watermark === undefined) { state.unproven = true; return; }
  if (!shutdown || watermark !== undefined) {
    const total = numeric(data.totalNanoAiu);
    if (shutdown || total !== null) state.credits.push({ session, time: timestamp, shutdown, total, key, file, watermark });
    return;
  }
  let complete = true;
  if (shutdown) for (const [model, raw] of Object.entries(recordField(data, "modelMetrics") || {})) {
    if (!isRecord(raw)) continue;
    const usage = recordField(raw, "usage");
    if (!usage || !model.trim()) continue;
    const input = nonNegativeInt(usage.inputTokens), cached = nonNegativeInt(usage.cacheReadTokens), created = nonNegativeInt(usage.cacheWriteTokens);
    const requests = nonNegativeInt(recordField(raw, "requests")?.count);
    const parts = { agent: "copilot" as const, model: normalizeModel(model), sessionId: session, sourcePath: file, timestamp,
      inputTokens: Math.max(0, input - cached - created), cachedInputTokens: cached, cacheCreationTokens: created,
      outputTokens: nonNegativeInt(usage.outputTokens) };
    const event = makeUsageEvent(parts) || (requests > 0 ? { ...parts, reasoningOutputTokens: 0, totalTokens: 0, bucketStart: toUtcHalfHourStart(timestamp)! } : null);
    if (!event) continue;
    const nano = numeric(raw.totalNanoAiu);
    complete &&= nano !== null;
    state.entries.push({ event, key: JSON.stringify([key, normalizeModel(model)]), requests, credits: nano });
  }
  const total = numeric(data.totalNanoAiu);
  if (shutdown || total !== null) state.credits.push({ session, time: timestamp, shutdown, total: complete ? total : null, key, file });
}

function otelTimestamp(row: Record<string, unknown>, fallback: string): string {
  for (const key of ["endTime", "startTime", "hrTime", "_hrTime", "time", "timestamp", "observedTimestamp", "timeUnixNano"]) {
    const value = row[key];
    if (typeof value === "string" && value.includes("T") && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
    const raw = Array.isArray(value) ? Number(value[0]) * 1000 + Number(value[1] || 0) / 1e6 : Number(value);
    if (!Number.isFinite(raw) || raw <= 0) continue;
    const millis = Array.isArray(value) ? raw : key === "timeUnixNano" || raw >= 1e17 ? raw / 1e6 : raw >= 1e14 ? raw / 1000 : raw >= 1e11 ? raw : raw * 1000;
    if (millis > 253_402_300_799_999) continue;
    return new Date(millis).toISOString();
  }
  return "";
}

interface OtelFile {
  file: string;
  rows: Record<string, unknown>[];
  fallback: string;
}
function otelRows(files: OtelFile[]): Entry[] {
  const contexts = new Map<string, { model?: string; session?: string; priority: number }>();
  const sessionKeys = ["gen_ai.conversation.id", "copilot_chat.session_id", "copilot_chat.chat_session_id", "session.id", "github.copilot.interaction_id", "gen_ai.response.id"];
  const metadata = (row: Record<string, unknown>) => {
    const a = recordField(row, "attributes") || {};
    const trace = stringField(row, "traceId") || stringField(recordField(row, "spanContext"), "traceId") || undefined;
    const model = stringField(a, "gen_ai.response.model") || stringField(a, "gen_ai.request.model") || undefined;
    const key = [...sessionKeys.slice(0, 4).reverse(), ...sessionKeys.slice(4)].find(k => stringField(a, k));
    return { a, trace, model, session: key ? String(a[key]) : undefined, priority: key ? key === "gen_ai.response.id" ? 1 : key === "github.copilot.interaction_id" ? 2 : 3 : 0 };
  };
  for (const { rows } of files) {
    for (const row of rows) {
      const m = metadata(row);
      if (!m.trace) continue;
      const old = contexts.get(m.trace) || { priority: 0 };
      contexts.set(m.trace, { model: old.model || m.model, session: m.priority > old.priority ? m.session : old.session, priority: Math.max(m.priority, old.priority) });
    }
  }
  const entries: Entry[] = [];
  for (const { file, rows, fallback } of files) rows.forEach((row, index) => {
    const m = metadata(row), a = m.a;
    const span = row.type ? row.type === "span" : !!(row.name && (row.spanId || row.traceId || row.startTime || row.endTime || row.duration || row.kind));
    const name = String(row.name || ""), body = String(row.body || row._body || "");
    const rank = span && (a["gen_ai.operation.name"] === "chat" || name.startsWith("chat ")) ? 0
      : !span && (a["event.name"] === "gen_ai.client.inference.operation.details" || body.startsWith("GenAI inference:")) ? 1
      : !span && (a["event.name"] === "copilot_chat.agent.turn" || body.startsWith("copilot_chat.agent.turn")) ? 2
      : span && (a["gen_ai.operation.name"] === "invoke_agent" || name.startsWith("invoke_agent ")) ? 3 : -1;
    if (rank < 0) return;
    const context = m.trace ? contexts.get(m.trace) : undefined;
    const session = context && context.priority > m.priority ? context.session : m.session || context?.session;
    const model = normalizeModel(m.model || context?.model || "unknown");
    const cached = nonNegativeInt(a["gen_ai.usage.cache_read.input_tokens"]);
    const created = nonNegativeInt(a["gen_ai.usage.cache_write.input_tokens"]) || nonNegativeInt(a["gen_ai.usage.cache_creation.input_tokens"]);
    const timestamp = otelTimestamp(row, fallback);
    const event = makeUsageEvent({ agent: "copilot", model, sessionId: session || m.trace || "unknown-session", sourcePath: file, timestamp,
      inputTokens: Math.max(0, nonNegativeInt(a["gen_ai.usage.input_tokens"]) - cached - created), cachedInputTokens: cached,
      cacheCreationTokens: created, outputTokens: nonNegativeInt(a["gen_ai.usage.output_tokens"]),
      totalTokens: nonNegativeInt(a["gen_ai.usage.total_tokens"]) || nonNegativeInt(a["gen_ai.usage.total.token_count"]) });
    if (!event) return;
    const response = stringField(a, "gen_ai.response.id") || undefined;
    const spanId = stringField(row, "spanId") || stringField(recordField(row, "spanContext"), "spanId");
    const key = m.trace && spanId ? JSON.stringify([rank === 1 ? "log" : "span", m.trace, spanId]) : JSON.stringify([rank, session, timestamp, file, index]);
    entries.push({ event, key, requests: 1, credits: null, rank, trace: m.trace, response, serviceRequest: stringField(a, "github.copilot.service_request_id") || undefined,
      reasoning: nonNegativeInt(a["gen_ai.usage.reasoning.output_tokens"]) || nonNegativeInt(a["gen_ai.usage.reasoning_tokens"]) });
  });
  return entries;
}

function unique<T extends { key: string }>(rows: T[]): T[] { return [...new Map(rows.map(row => [row.key, row])).values()]; }
function reconcile(native: Entry[], otel: Entry[], credits: Credit[], records: Entry[]): UsageEvent[] {
  const exportedCalls = new Map<string, Entry>();
  for (const call of otel.sort((a, b) => time(a.event) - time(b.event))) {
    const earlier = exportedCalls.get(call.key);
    if (earlier) {
      earlier.serviceRequest ??= call.serviceRequest;
      earlier.response ??= call.response;
    } else exportedCalls.set(call.key, call);
  }
  const calls = [...exportedCalls.values()];
  const seenChat = new Set<string>();
  const retained = calls.filter(call => {
    if (call.rank === 0 && call.response) {
      const e = call.event;
      const key = JSON.stringify([call.response, call.serviceRequest, e.model, e.inputTokens, e.cachedInputTokens, e.cacheCreationTokens, e.outputTokens, call.reasoning, e.extraTotalTokens]);
      if (seenChat.has(key)) return false; seenChat.add(key);
    }
    return !calls.some(other => other.rank! < call.rank! && ((call.trace && other.trace === call.trace) || (call.response && other.response === call.response)));
  });
  const groups = new Map<string, Entry[]>();
  for (const entry of unique(native)) { const key = pair(entry.event); const group = groups.get(key) || []; group.push(entry); groups.set(key, group); }
  const events: UsageEvent[] = [], attributed = new Map<string, number>(), after = new Map<string, number>();
  for (const [key, group] of groups) {
    group.sort((a, b) => time(a.event) - time(b.event));
    const matches = retained.filter(call => pair(call.event) === key);
    let start = -1, counted = 0, reported = 0, previousRequests = 0;
    group.forEach((entry, index) => {
      const through = matches.filter(call => time(call.event) <= time(entry.event)).length;
      if (start < 0 && through > counted) start = index;
      if (start >= 0) reported += Math.max(0, entry.requests - previousRequests);
      counted = through; previousRequests = entry.requests;
    });
    const replace = start >= 0 && counted > reported && group.every(entry => entry.requests > 0);
    after.set(key, replace ? start > 0 ? time(group[start - 1].event) : -Infinity : time(group[group.length - 1].event));
    let previous: Entry | undefined;
    group.forEach((entry, index) => {
      const e = { ...entry.event };
      if (previous) for (const field of ["inputTokens", "cachedInputTokens", "outputTokens", "cacheCreationTokens", "totalTokens", "extraTotalTokens"] as const) e[field] = Math.max(0, (e[field] || 0) - (previous.event[field] || 0));
      const creditKey = JSON.stringify([e.sessionId, Date.parse(e.timestamp)]);
      const nano = entry.credits !== null && (!previous || previous.credits !== null) ? Math.max(0, entry.credits - (previous?.credits || 0)) : null;
      attributed.set(creditKey, (attributed.get(creditKey) || 0) + (nano || 0));
      if (nano !== null) e.recordedCostUsd = creditsToUsd(nano);
      previous = entry;
      if ((!replace || index < start) && (e.totalTokens > 0 || Number(e.recordedCostUsd) > 0)) events.push(e);
    });
  }
  const receipts = deduplicateRecords(records);
  const matched = matchRecordedCalls(retained, receipts);
  const uncovered = new Map<string, number>();
  for (const [index, call] of retained.entries()) {
    if (time(call.event) <= (after.get(pair(call.event)) ?? -Infinity)) continue;
    if (!matched.has(index)) events.push(call.event);
    if (matched.get(index) !== true && call.event.sessionId) uncovered.set(call.event.sessionId,
      Math.min(uncovered.get(call.event.sessionId) ?? Infinity, time(call.event)));
  }
  appendItems(events, receipts.map(record => ({ ...record.event, ...(record.credits !== null ? { recordedCostUsd: creditsToUsd(record.credits) } : {}) })));
  const sessions = new Map<string, Credit[]>();
  for (const snapshot of unique(credits)) { const group = sessions.get(snapshot.session) || []; group.push(snapshot); sessions.set(snapshot.session, group); }
  for (const [session, group] of sessions) {
    if (group.every(s => s.shutdown) || group.some(s => s.shutdown && s.total === null)) continue;
    group.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || Number(a.shutdown) - Number(b.shutdown));
    const receiptAmounts = coveredReceiptCredits(group, receipts.filter(record => record.event.sessionId === session && record.sourceSession === session));
    if (receiptAmounts === null) continue;
    let last = -1;
    group.forEach((s, index) => { if (s.shutdown) last = index; });
    let total = 0, known = 0;
    const points: { snapshot: Credit; gap: number }[] = [];
    group.forEach((snapshot, index) => {
      if (!snapshot.shutdown && index < last) return;
      total = Math.max(total, snapshot.total || 0);
      if (snapshot.shutdown && snapshot.watermark === undefined) known += attributed.get(JSON.stringify([session, Date.parse(snapshot.time)])) || 0;
      points.push({ snapshot, gap: Math.max(0, total - known - (receiptAmounts[index] || 0)) });
    });
    let lasting = Infinity;
    for (const point of [...points].reverse()) { lasting = Math.min(lasting, point.gap); point.gap = lasting; }
    let reported = 0;
    for (const { snapshot, gap } of points) {
      const delta = Math.max(0, gap - reported); reported = Math.max(reported, gap);
      const event = delta && (uncovered.get(session) ?? Infinity) > Date.parse(snapshot.time) ? makeUsageEvent({ agent: "copilot", model: "unknown", sessionId: session, sourcePath: snapshot.file,
        timestamp: snapshot.time, recordedCostUsd: creditsToUsd(delta) }) : null;
      if (event) events.push(event);
    }
  }
  return events.sort((a, b) => time(a) - time(b));
}

function deduplicateRecords(records: Entry[]): Entry[] {
  const kept = new Map<string, Entry>();
  const rank = (record: Entry) => Number(record.sourceSession !== record.event.sessionId);
  for (const record of records) {
    const old = kept.get(record.key);
    if (!old || rank(record) < rank(old) || rank(record) === rank(old) && (record.event.sessionId || "") < (old.event.sessionId || "")) kept.set(record.key, record);
  }
  return [...kept.values()].sort((a, b) => time(a.event) - time(b.event) || a.key.localeCompare(b.key));
}

function coveredReceiptCredits(snapshots: Credit[], records: Entry[]): number[] | null {
  if (!snapshots.some(snapshot => snapshot.watermark !== undefined)) return [];
  const ordered = records.filter(record => record.sequence !== undefined).sort((a, b) => a.sequence! - b.sequence!);
  if (!ordered.length) return null;
  const sums: Array<number | null> = [];
  let sum: number | null = 0;
  for (const [index, record] of ordered.entries()) {
    if (index && time(record.event) < time(ordered[index - 1].event)) return null;
    sum = record.sequence === index + 1 && record.credits !== null && sum !== null && Number.isSafeInteger(sum + record.credits) ? sum + record.credits : null;
    sums.push(sum);
  }
  let previousWatermark = 0, previousTotal = 0;
  const result: number[] = [];
  for (const snapshot of snapshots) {
    if (snapshot.watermark === undefined) {
      if (previousWatermark || Date.parse(snapshot.time) >= time(ordered[0].event)) return null;
      result.push(0); continue;
    }
    const index = snapshot.watermark - 1, record = ordered[index], amount = sums[index];
    if (!record || amount === null || amount === undefined || snapshot.total === null || snapshot.watermark < previousWatermark
      || snapshot.total < previousTotal || amount > snapshot.total || time(record.event) > Date.parse(snapshot.time)
      || ordered[index + 1] && time(ordered[index + 1].event) <= Date.parse(snapshot.time)) return null;
    previousWatermark = snapshot.watermark; previousTotal = snapshot.total; result.push(amount);
  }
  return result;
}

function matchRecordedCalls(calls: Entry[], records: Entry[]): Map<number, boolean> {
  const claimed = new Map<number, boolean>(), matched = new Set<Entry>();
  const byId = new Map<string, number[]>();
  for (const [index, call] of calls.entries()) {
    for (const field of ["serviceRequest", "response"] as const) {
      if (!call[field]) continue;
      const key = JSON.stringify([field, call[field], call.event.model]);
      const indexes = byId.get(key) || [];
      indexes.push(index); byId.set(key, indexes);
    }
  }
  for (const field of ["serviceRequest", "response"] as const) {
    for (const record of records) {
      if (matched.has(record) || !record[field]) continue;
      let nearest = -1;
      for (const index of byId.get(JSON.stringify([field, record[field], record.event.model])) || []) {
        if (claimed.has(index)) continue;
        const call = calls[index];
        if (nearest < 0 || Math.abs(time(call.event) - time(record.event)) < Math.abs(time(calls[nearest].event) - time(record.event))) nearest = index;
      }
      if (nearest >= 0) { claimed.set(nearest, calls[nearest].event.sessionId === record.event.sessionId); matched.add(record); }
    }
  }
  return claimed;
}

export async function planCopilot(home: string) {
  const root = expandSourcePath(process.env.COPILOT_HOME?.trim() || path.join(home, ".copilot"), home);
  const state = path.join(root, "session-state");
  const nativeFiles = await storeFiles(
    state,
    (file) =>
      path.basename(file) === "events.jsonl" &&
      path.relative(state, file).split(path.sep).length === 2,
  );
  const otelFiles = await storeFiles(path.join(root, "otel"), (file) =>
    file.endsWith(".jsonl"),
  );
  const explicit = process.env.COPILOT_OTEL_FILE_EXPORTER_PATH?.trim() ? expandSourcePath(process.env.COPILOT_OTEL_FILE_EXPORTER_PATH.trim(), home) : undefined;
  if (
    explicit &&
    (
      await fs.stat(explicit).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      })
    )?.isFile()
  )
    otelFiles.push(explicit);
  return {
    files: [...nativeFiles, ...new Set(otelFiles)],
    collect: async () => {
      const native: Entry[] = [],
        telemetry: OtelFile[] = [],
        records: Entry[] = [],
        credits: Credit[] = [];
      for (const file of nativeFiles) {
        const parsed = await scanFile(file, () => cachedSource("copilot-native", [file], async () => (await readIncrementalJsonl(file, saved => copilotParser(file, false, saved))).state as CopilotState));
        appendItems(native, parsed.entries);
        if (!parsed.covered || !parsed.unproven && parsed.credits.some(snapshot => snapshot.watermark !== undefined)) appendItems(credits, parsed.credits);
        appendItems(records, parsed.records);
      }
      for (const file of [...new Set(otelFiles)].sort()) {
        const parsed = await scanFile(file, () => cachedSource("copilot-otel", [file], async () => {
          const result = await readIncrementalJsonl(file, saved => copilotParser(file, true, saved));
          return { file, rows: (result.state as CopilotState).rows, fallback: (await fs.stat(file)).mtime.toISOString() };
        }));
        telemetry.push(parsed);
      }
      return {
        events: reconcile(native, otelRows(telemetry), credits, records),
        source: {
          agent: "copilot" as const,
          path: root,
          files: nativeFiles.length + new Set(otelFiles).size,
          exists: nativeFiles.length + otelFiles.length > 0,
        },
      };
    },
  };
}

export async function collectCopilot(home: string) { return (await planCopilot(home)).collect(); }
