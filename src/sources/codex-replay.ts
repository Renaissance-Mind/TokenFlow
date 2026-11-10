import type { UsageEvent } from "../types.js";

export interface CodexSession {
  id: string;
  parent?: string;
  forkTime?: string;
  rewrittenBurst?: string | null;
  spawnedRecordIndex?: number;
  events: UsageEvent[];
  compactions: Map<string, string>;
}

function usageKey(event: UsageEvent): string {
  return [
    event.inputTokens,
    event.cachedInputTokens,
    event.cacheCreationTokens,
    event.outputTokens,
    event.reasoningOutputTokens,
    event.totalTokens,
  ].join("|");
}

export function dedupeCodexSessions(sessions: CodexSession[]): UsageEvent[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const output: UsageEvent[] = [];
  const seen = new Map<string, number>();
  for (const session of sessions) {
    const parent = session.parent ? byId.get(session.parent) : undefined;
    const prefix =
      parent?.events.filter(
        (event) =>
          !event.messageId &&
          (!session.forkTime || event.timestamp <= session.forkTime),
      ) || [];
    const normal = session.events.filter((event) => !event.messageId);
    let replayIndex = 0;
    let matching = !!session.parent;
    let burstEnd: number | null = null;
    // Equal usage at one timestamp may describe multiple requests in one file.
    const occurrences = new Map<string, number>();
    for (const [eventIndex, event] of session.events.entries()) {
      if (session.spawnedRecordIndex !== undefined && eventIndex >= session.spawnedRecordIndex) {
        matching = false; burstEnd = null;
      }
      if (event.messageId) {
        const inherited = parent?.compactions.get(event.messageId);
        if (inherited && (!session.forkTime || inherited <= session.forkTime))
          continue;
      } else if (matching) {
        if (
          prefix[replayIndex] &&
          usageKey(event) === usageKey(prefix[replayIndex])
        ) {
          replayIndex++;
          continue;
        }
        matching = false;
        if (replayIndex === 0 && session.rewrittenBurst) {
          burstEnd = Date.parse(session.rewrittenBurst);
        } else if (
          replayIndex === 0 && session.rewrittenBurst === undefined &&
          normal.length > 1 &&
          (!session.forkTime || Math.abs(Date.parse(normal[0].timestamp) - Date.parse(session.forkTime)) <= 1000) &&
          Date.parse(normal[1].timestamp) >= Date.parse(normal[0].timestamp) &&
          Date.parse(normal[1].timestamp) - Date.parse(normal[0].timestamp) <=
            1000
        )
          burstEnd = Date.parse(normal[0].timestamp);
      }
      if (!event.messageId && burstEnd !== null) {
        const time = Date.parse(event.timestamp);
        if (time >= burstEnd && time - burstEnd <= 1000) {
          burstEnd = time;
          continue;
        }
        burstEnd = null;
      }
      const baseKey = `${session.id}|${event.timestamp}|${event.model}|${usageKey(event)}`;
      const occurrence = occurrences.get(baseKey) || 0;
      if (!event.messageId) occurrences.set(baseKey, occurrence + 1);
      const key = event.messageId
        ? `request|${event.messageId}`
        : `${baseKey}|${occurrence}`;
      const previousIndex = seen.get(key);
      if (previousIndex === undefined) {
        const retained = event.messageId ? { ...event } : event;
        seen.set(key, output.length);
        output.push(retained);
      } else {
        const existing = output[previousIndex];
        const priority = { standard: 4, ultrafast: 3, fast: 2, flex: 1 };
        const previous = existing.recordedServiceTier ? priority[existing.recordedServiceTier] : 0;
        const incoming = event.recordedServiceTier ? priority[event.recordedServiceTier] : 0;
        if (incoming > previous) {
          output[previousIndex] = { ...existing, serviceTier: event.serviceTier,
            recordedServiceTier: event.recordedServiceTier, costMultiplier: event.costMultiplier };
        }
      }
    }
  }
  return output;
}
