import type { UsageEvent, PricingProfile } from "./types.js";
import { aggregateEvents } from "./usage-buckets.js";

export interface DayUsage { date: string; tokens: number; costUsd: number; unpricedTokens: number }
export interface LocalSummary {
  scannedAt: string;
  today: DayUsage;
  days: DayUsage[];
  agents: Array<{ agent: string; tokens: number; costUsd: number }>;
  sources: Array<{ agent: string; exists: boolean; files: number; path: string }>;
}
export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function summarizeLocal(events: UsageEvent[], profiles: PricingProfile[], sources: LocalSummary["sources"]): LocalSummary {
  const now = new Date();
  const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(now); d.setDate(d.getDate() - 6 + i); return localDate(d); });
  const wanted = new Set(dates);
  const days = new Map<string, UsageEvent[]>();
  for (const event of events) {
    const date = localDate(new Date(event.timestamp));
    if (wanted.has(date)) { const day = days.get(date) || []; day.push(event); days.set(date, day); }
  }
  const agents = new Map<string, { agent: string; tokens: number; costUsd: number }>();
  const summaries: DayUsage[] = dates.map((date) => {
    const summary = { date, tokens: 0, costUsd: 0, unpricedTokens: 0 };
    for (const bucket of aggregateEvents(days.get(date) || [], profiles)) {
      summary.tokens += bucket.totalTokens; summary.costUsd += Number(bucket.cost.totalUsd);
      if (bucket.pricingStatus === "unpriced") summary.unpricedTokens += bucket.totalTokens;
      if (date === dates.at(-1)) {
        const agent = agents.get(bucket.agent) || { agent: bucket.agent, tokens: 0, costUsd: 0 };
        agent.tokens += bucket.totalTokens; agent.costUsd += Number(bucket.cost.totalUsd); agents.set(bucket.agent, agent);
      }
    }
    return summary;
  });
  return { scannedAt: now.toISOString(), today: summaries.at(-1)!, days: summaries,
    agents: [...agents.values()].sort((a, b) => b.tokens - a.tokens), sources };
}
