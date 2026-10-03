import type { UsageEvent } from "../types.js";

export interface CodexSession {
  id: string;
  parent?: string;
  forkTime?: string;
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
  const seen = new Set<string>();
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
    for (const event of session.events) {
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
        if (
          replayIndex === 0 &&
          normal.length > 1 &&
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
      const key = event.messageId
        ? `request|${event.messageId}`
        : `${session.id}|${event.timestamp}|${event.model}|${usageKey(event)}`;
      if (!seen.has(key)) {
        seen.add(key);
        output.push(event);
      }
    }
  }
  return output;
}
