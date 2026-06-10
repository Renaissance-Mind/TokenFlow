import type { AgentSource, CostBreakdown, PricingProfile, PricingRate, UsageTotals } from "./types.js";
import { BUILTIN_PRICING } from "./pricing-data.js";

export { BUILTIN_PRICING } from "./pricing-data.js";

const MICRO_USD_SCALE = 1_000_000n;

export function calculateCost(
  agent: AgentSource,
  totals: UsageTotals,
  pricing: PricingRate,
  multiplier = "1",
): CostBreakdown {
  const inputIncludesCacheRead = agent === "codex" || agent === "gemini";
  const billableInputTokens = inputIncludesCacheRead
    ? Math.max(0, totals.inputTokens - totals.cachedInputTokens)
    : totals.inputTokens;
  const billableOutputTokens = totals.outputTokens + totals.reasoningOutputTokens;

  const inputMicro = tokenCostMicroUsd(billableInputTokens, pricing.inputUsdPerMillion);
  const outputMicro = tokenCostMicroUsd(billableOutputTokens, pricing.outputUsdPerMillion);
  const cacheReadMicro = tokenCostMicroUsd(totals.cachedInputTokens, pricing.cacheReadUsdPerMillion);
  const cacheCreationMicro = tokenCostMicroUsd(
    totals.cacheCreationTokens,
    pricing.cacheCreationUsdPerMillion,
  );
  const multiplierMicro = parseDecimalToMicroUnits(multiplier);
  const baseTotal = inputMicro + outputMicro + cacheReadMicro + cacheCreationMicro;
  const totalMicro = (baseTotal * multiplierMicro + MICRO_USD_SCALE / 2n) / MICRO_USD_SCALE;

  return {
    inputUsd: formatMicroUsd(inputMicro),
    outputUsd: formatMicroUsd(outputMicro),
    cacheReadUsd: formatMicroUsd(cacheReadMicro),
    cacheCreationUsd: formatMicroUsd(cacheCreationMicro),
    totalUsd: formatMicroUsd(totalMicro),
  };
}

export function resolvePricing(model: string, extraProfiles: PricingProfile[] = []): PricingProfile | null {
  const candidates = pricingCandidates(model);
  const pricingByModel = new Map(BUILTIN_PRICING.map((profile) => [profile.modelId, profile]));
  for (const profile of extraProfiles) pricingByModel.set(profile.modelId, profile);
  for (const candidate of candidates) {
    const exact = pricingByModel.get(candidate);
    if (exact) return exact;
  }
  const allPricing = [...extraProfiles, ...BUILTIN_PRICING];
  for (const candidate of candidates) {
    if (!shouldTryPricingPrefixMatch(candidate)) continue;
    const prefixMatch = allPricing.find((profile) => profile.modelId.startsWith(`${candidate}-`));
    if (prefixMatch) return prefixMatch;
  }
  return null;
}

export function normalizeModelForPricing(model: string): string {
  let cleaned = cleanModelId(model);
  cleaned = stripKnownNamespace(cleaned) || cleaned;
  cleaned = stripBedrockVersionSuffix(cleaned) || cleaned;
  cleaned = stripModelDateSuffix(cleaned) || cleaned;
  return cleaned || "unknown";
}

export function normalizeAgentModel(agent: AgentSource, model: string | null | undefined): string {
  const cleaned = normalizeModelForPricing(model || "unknown");
  if (agent === "codex") return stripModelDateSuffix(cleaned) || cleaned;
  return cleaned || "unknown";
}

function pricingCandidates(model: string): string[] {
  const cleaned = cleanModelId(model);
  if (!cleaned || cleaned === "unknown" || cleaned === "null" || cleaned === "none") return [];

  const out: string[] = [];
  const queue = [cleaned];

  while (queue.length > 0) {
    const candidate = queue.shift();
    if (!candidate || out.includes(candidate)) continue;
    out.push(candidate);

    const namespaceStripped = stripKnownNamespace(candidate);
    if (namespaceStripped) queue.push(namespaceStripped);
    const claudeWrapperStripped = stripClaudeDesktopNonAnthropicPrefix(candidate);
    if (claudeWrapperStripped) queue.push(claudeWrapperStripped);
    const bedrockStripped = stripBedrockVersionSuffix(candidate);
    if (bedrockStripped) queue.push(bedrockStripped);
    const dateStripped = stripModelDateSuffix(candidate);
    if (dateStripped) queue.push(dateStripped);
    const effortStripped = stripReasoningEffortSuffix(candidate);
    if (effortStripped) queue.push(effortStripped);
    if (candidate.startsWith("claude-") && candidate.includes(".")) {
      queue.push(candidate.replaceAll(".", "-"));
    }
  }

  return out;
}

function cleanModelId(model: string): string {
  const afterSlash = model.includes("/") ? model.slice(model.lastIndexOf("/") + 1) : model;
  const beforeColon = afterSlash.split(":")[0] || afterSlash;
  return beforeColon.trim().replace(/\[1m\]$/i, "").replaceAll("@", "-").toLowerCase();
}

function stripKnownNamespace(model: string): string | null {
  const claudePos = model.lastIndexOf("claude-");
  if (claudePos > 0) return model.slice(claudePos);

  for (const marker of ["openai.", "anthropic.", "google.", "moonshot.", "moonshotai.", "bedrock.", "global."]) {
    if (model.startsWith(marker)) return model.slice(marker.length);
  }
  return null;
}

function stripClaudeDesktopNonAnthropicPrefix(model: string): string | null {
  if (!model.startsWith("claude-")) return null;
  const rest = model.slice("claude-".length);
  return NON_ANTHROPIC_CLAUDE_WRAPPER_PREFIXES.some((prefix) => rest.startsWith(prefix))
    ? rest
    : null;
}

function stripBedrockVersionSuffix(model: string): string | null {
  const match = model.match(/^(.*)-v\d+$/);
  return match?.[1] || null;
}

function stripModelDateSuffix(model: string): string | null {
  const iso = model.match(/^(.*)-\d{4}-\d{2}-\d{2}$/);
  if (iso?.[1]) return iso[1];
  const compact = model.match(/^(.*)-\d{8}$/);
  if (compact?.[1]) return compact[1];
  return null;
}

function stripReasoningEffortSuffix(model: string): string | null {
  const effort = model.match(/^(.*)-(minimal|low|medium|high|xhigh)$/);
  return effort?.[1] || null;
}

function shouldTryPricingPrefixMatch(model: string): boolean {
  const dashCount = (model.match(/-/g) || []).length;
  if (model.startsWith("claude-")) return dashCount >= 3;
  if (["o1", "o3", "o4", "o5"].some((prefix) => model.startsWith(prefix))) return dashCount >= 1;
  return PREFIX_MATCH_FAMILIES.some((prefix) => model.startsWith(prefix)) && dashCount >= 2;
}

const PREFIX_MATCH_FAMILIES = [
  "gpt-",
  "gemini-",
  "deepseek-",
  "qwen-",
  "glm-",
  "kimi-",
  "minimax-",
];

const NON_ANTHROPIC_CLAUDE_WRAPPER_PREFIXES = [
  "abab",
  "ark-code",
  "arctic",
  "astron",
  "codex",
  "command-r",
  "deepseek",
  "doubao",
  "ernie",
  "gemini",
  "gemma",
  "glm",
  "gpt",
  "grok",
  "hermes",
  "hy3",
  "hunyuan",
  "jamba",
  "kimi",
  "lfm",
  "llama",
  "longcat",
  "mercury",
  "mimo",
  "minimax",
  "mistral",
  "mixtral",
  "moonshot",
  "nemotron",
  "nova-",
  "openai",
  "qianfan",
  "qwen",
  "seed-",
  "solar",
  "stepfun",
];

function tokenCostMicroUsd(tokens: number, usdPerMillion: string): bigint {
  const rateMicroUsdPerMillion = parseDecimalToMicroUnits(usdPerMillion);
  const safeTokens = BigInt(Math.max(0, Math.floor(tokens)));
  return (safeTokens * rateMicroUsdPerMillion + 500_000n) / 1_000_000n;
}

function parseDecimalToMicroUnits(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  const padded = `${fraction}000000`.slice(0, 6);
  return BigInt(whole) * MICRO_USD_SCALE + BigInt(padded);
}

function formatMicroUsd(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / MICRO_USD_SCALE;
  const fraction = (abs % MICRO_USD_SCALE).toString().padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}
