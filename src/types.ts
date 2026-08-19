export type AgentSource =
  | "codex"
  | "claude"
  | "gemini"
  | "opencode"
  | "kimi"
  | "qwen"
  | "amp"
  | "codebuff"
  | "droid"
  | "goose"
  | "hermes"
  | "kilo"
  | "openclaw"
  | "pi"
  | "unknown";

export interface UsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cacheCreationTokens: number;
  cacheCreation5mTokens?: number;
  cacheCreation1hTokens?: number;
  extraTotalTokens?: number;
  longContextInputTokens?: number;
  longContextCachedInputTokens?: number;
  longContextOutputTokens?: number;
  longContextReasoningOutputTokens?: number;
  longContextCacheCreationTokens?: number;
  longContextCacheCreation5mTokens?: number;
  longContextCacheCreation1hTokens?: number;
  longContextExtraTotalTokens?: number;
  fastInputTokens?: number;
  fastCachedInputTokens?: number;
  fastOutputTokens?: number;
  fastReasoningOutputTokens?: number;
  fastCacheCreationTokens?: number;
  fastCacheCreation5mTokens?: number;
  fastCacheCreation1hTokens?: number;
  fastExtraTotalTokens?: number;
  fastLongContextInputTokens?: number;
  fastLongContextCachedInputTokens?: number;
  fastLongContextOutputTokens?: number;
  fastLongContextReasoningOutputTokens?: number;
  fastLongContextCacheCreationTokens?: number;
  fastLongContextCacheCreation5mTokens?: number;
  fastLongContextCacheCreation1hTokens?: number;
  fastLongContextExtraTotalTokens?: number;
  totalTokens: number;
}

export interface UsageEvent extends UsageTotals {
  agent: AgentSource;
  model: string;
  pricingModel?: string;
  costMultiplier?: string;
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
  longContextThresholdTokens?: number;
  fastMultiplier?: string;
}

export interface PricingProfile extends PricingRate {
  modelId: string;
  displayName: string;
  exactOnly?: boolean;
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
  costMultiplier?: string;
  bucketStart: string;
  cost: CostBreakdown;
  pricingStatus: "priced" | "unpriced";
  recordedCostUsd?: string;
}
