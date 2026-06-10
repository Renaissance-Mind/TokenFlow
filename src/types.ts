export type AgentSource = "codex" | "claude" | "gemini" | "opencode" | "kimi" | "qwen" | "unknown";

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheCreationTokens: number;
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
  extraTotalTokens?: number;
  totalTokens: number;
}

export interface UsageEvent extends UsageTotals {
  agent: AgentSource;
  model: string;
  pricingModel?: string;
  sessionId: string | null;
  sourcePath: string;
  timestamp: string;
  bucketStart: string;
  recordedCostUsd?: string;
}

export interface PricingRate {
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  cacheReadUsdPerMillion: string;
  cacheCreationUsdPerMillion: string;
  inputAbove200kUsdPerMillion?: string;
  outputAbove200kUsdPerMillion?: string;
  cacheReadAbove200kUsdPerMillion?: string;
  cacheCreationAbove200kUsdPerMillion?: string;
  fastMultiplier?: string;
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
  pricingModel?: string;
  bucketStart: string;
  cost: CostBreakdown;
  pricingStatus: "priced" | "unpriced";
  recordedCostUsd?: string;
}
