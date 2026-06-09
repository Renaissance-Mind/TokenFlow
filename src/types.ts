export type AgentSource = "codex" | "claude" | "gemini" | "opencode" | "kimi" | "unknown";

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
}

export interface UsageEvent extends UsageTotals {
  agent: AgentSource;
  model: string;
  sessionId: string | null;
  sourcePath: string;
  timestamp: string;
  bucketStart: string;
}

export interface PricingRate {
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cacheReadUsdPerMillion: string;
  cacheCreationUsdPerMillion: string;
}

export interface PricingProfile extends PricingRate {
  modelId: string;
  displayName: string;
}

export interface CostBreakdown {
  inputUsd: string;
  outputUsd: string;
  cacheReadUsd: string;
  cacheCreationUsd: string;
  totalUsd: string;
}

export interface UsageBucket extends UsageTotals {
  agent: AgentSource;
  model: string;
  bucketStart: string;
  cost: CostBreakdown;
}
