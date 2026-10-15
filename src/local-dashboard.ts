import type { UsageBucket } from "./types.js";

// The same response shapes consumed by the web Dashboard. No message text,
// session identifiers, credentials, or source paths are stored in this cache.
export interface DashboardCache {
  scannedAt: string;
  buckets: Array<Pick<UsageBucket, "agent" | "model" | "bucketStart" | "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningOutputTokens" | "cacheCreationTokens" | "totalTokens" | "pricingStatus"> & { costUsd: string }>;
}
export function dashboardCache(buckets: UsageBucket[]): DashboardCache {
  return { scannedAt: new Date().toISOString(), buckets: buckets.map(b => ({
    agent: b.agent, model: b.model, bucketStart: b.bucketStart,
    inputTokens: b.inputTokens, cachedInputTokens: b.cachedInputTokens,
    outputTokens: b.outputTokens, reasoningOutputTokens: b.reasoningOutputTokens,
    cacheCreationTokens: b.cacheCreationTokens, totalTokens: b.totalTokens,
    pricingStatus: b.pricingStatus, costUsd: b.cost.totalUsd,
  })) };
}
const fields = { input_tokens: "inputTokens", cached_input_tokens: "cachedInputTokens", output_tokens: "outputTokens", reasoning_output_tokens: "reasoningOutputTokens", cache_creation_tokens: "cacheCreationTokens", total_tokens: "totalTokens" } as const;
const micro = (v: string) => { const [whole, fraction = ""] = v.split("."); return BigInt(whole || "0") * 1_000_000n + BigInt((fraction + "000000").slice(0, 6)); };
const usd = (v: bigint) => `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
function totals(buckets: DashboardCache["buckets"]) {
  const value: Record<string, string> = {};
  for (const [key, field] of Object.entries(fields)) value[key] = buckets.reduce((s, b) => s + BigInt(b[field as keyof typeof b] as number || 0), 0n).toString();
  value.total_cost_usd = usd(buckets.reduce((s, b) => s + micro(b.costUsd), 0n));
  value.unpriced_buckets = String(buckets.filter(b => b.pricingStatus === "unpriced").length);
  return value;
}
export function localDashboardApi(cache: DashboardCache | null, config: { deviceId?: string; deviceName?: string; lastSyncAt?: string } | null, request: string): unknown {
  const url = new URL(request, "https://tokenflow.local");
  const id = config?.deviceId || "local-device", name = config?.deviceName || "Computer";
  if (url.pathname === "/api/me") return { authenticated: true, user: { id: "local", name, email: null, persona_key: null } };
  if (url.pathname === "/api/devices") return { devices: [{ id, name, platform: process.platform, status: "active", last_sync_at: config?.lastSyncAt || null }] };
  const to = url.searchParams.get("to") || new Date().toISOString().slice(0, 10);
  const days = Math.min(370, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const from = url.searchParams.get("from") || new Date(Date.parse(to + "T00:00:00.000Z") - (days - 1) * 86400000).toISOString().slice(0, 10);
  const start = Date.parse(from + "T00:00:00.000Z"), end = Date.parse(to + "T23:59:59.999Z");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || !Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start >= 370 * 86400000) throw new Error("Invalid Dashboard date range");
  const buckets = (cache?.buckets || []).filter(b => {
    const at = Date.parse(b.bucketStart);
    return at >= start && at <= end && (!url.searchParams.get("device_id") || url.searchParams.get("device_id") === id)
      && (!url.searchParams.get("agent") || url.searchParams.get("agent") === b.agent)
      && (!url.searchParams.get("model") || url.searchParams.get("model") === b.model);
  });
  if (url.pathname === "/api/usage/summary") {
    const groups = new Map<string, DashboardCache["buckets"]>();
    for (const b of buckets) { const k = `${b.agent}|${b.model}`; const group = groups.get(k) || []; group.push(b); groups.set(k, group); }
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), totals: totals(buckets),
      devices: buckets.length ? [{ device_id: id, device_name: name, last_sync_at: config?.lastSyncAt || null, ...totals(buckets) }] : [],
      models: [...groups.values()].map(g => ({ agent: g[0].agent, model: g[0].model, ...totals(g) })) };
  }
  if (url.pathname === "/api/usage/hourly") {
    if (end - start >= 92 * 86400000) throw new Error("Hourly date range cannot exceed 92 days");
    const groups = new Map<string, DashboardCache["buckets"]>();
    for (const b of buckets) { const k = b.bucketStart.slice(0, 13); const g = groups.get(k) || []; g.push(b); groups.set(k, g); }
    return { from, to, ...totals(buckets), hours: [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hour, g]) => ({ hour, ...totals(g) })) };
  }
  if (url.pathname === "/api/usage/heatmap") {
    const metric = url.searchParams.get("metric") === "cost" ? "cost" : "tokens";
    const groups = new Map<string, DashboardCache["buckets"]>();
    for (const b of buckets) { const k = b.bucketStart.slice(0, 10); const g = groups.get(k) || []; g.push(b); groups.set(k, g); }
    const dayRows: Array<{ date: string; total_tokens: string; total_cost_usd: string; value: string }> = [];
    for (let at = start; at <= end; at += 86400000) {
      const date = new Date(at).toISOString().slice(0, 10), t = totals(groups.get(date) || []);
      dayRows.push({ date, total_tokens: t.total_tokens, total_cost_usd: t.total_cost_usd, value: metric === "cost" ? t.total_cost_usd : t.total_tokens });
    }
    const value = (d: typeof dayRows[number]) => metric === "cost" ? micro(d.value) : BigInt(d.value);
    const max = dayRows.reduce((s, d) => value(d) > s ? value(d) : s, 0n);
    return { from, to, metric, total_tokens: totals(buckets).total_tokens, total_cost_usd: totals(buckets).total_cost_usd,
      days: dayRows.map(d => ({ ...d, level: value(d) <= 0n || max <= 0n ? 0 : Math.max(1, Math.min(4, Math.ceil(Number(value(d) * 4000n / max) / 1000))) })) };
  }
  throw new Error("Unsupported Dashboard request");
}
