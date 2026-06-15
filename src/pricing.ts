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
  const billableOutputTokens =
    totals.outputTokens + totals.reasoningOutputTokens + (totals.extraTotalTokens || 0);

  const inputMicro = tieredTokenCostMicroUsd(
    billableInputTokens,
    pricing.inputUsdPerMillion,
    pricing.inputAbove200kUsdPerMillion,
  );
  const outputMicro = tieredTokenCostMicroUsd(
    billableOutputTokens,
    pricing.outputUsdPerMillion,
    pricing.outputAbove200kUsdPerMillion,
  );
  const cacheReadMicro = tieredTokenCostMicroUsd(
    totals.cachedInputTokens,
    pricing.cacheReadUsdPerMillion,
    pricing.cacheReadAbove200kUsdPerMillion,
  );
  const cacheCreationMicro = cacheCreationCostMicroUsd(totals, pricing);
  const multiplierMicro = parseDecimalToMicroUnits(multiplier);
  const scaledInputMicro = applyMultiplier(inputMicro, multiplierMicro);
  const scaledOutputMicro = applyMultiplier(outputMicro, multiplierMicro);
  const scaledCacheReadMicro = applyMultiplier(cacheReadMicro, multiplierMicro);
  const scaledCacheCreationMicro = applyMultiplier(cacheCreationMicro, multiplierMicro);
  const totalMicro = scaledInputMicro + scaledOutputMicro + scaledCacheReadMicro + scaledCacheCreationMicro;

  return {
    inputUsd: formatMicroUsd(scaledInputMicro),
    outputUsd: formatMicroUsd(scaledOutputMicro),
    cacheReadUsd: formatMicroUsd(scaledCacheReadMicro),
    cacheCreationUsd: formatMicroUsd(scaledCacheCreationMicro),
    totalUsd: formatMicroUsd(totalMicro),
  };
}

function cacheCreationCostMicroUsd(totals: UsageTotals, pricing: PricingRate): bigint {
  const cacheCreation5mTokens = totals.cacheCreation5mTokens || 0;
  const cacheCreation1hTokens = totals.cacheCreation1hTokens || 0;
  if (cacheCreation5mTokens || cacheCreation1hTokens) {
    return (
      tieredTokenCostMicroUsd(
        cacheCreation5mTokens,
        pricing.cacheCreationUsdPerMillion,
        pricing.cacheCreationAbove200kUsdPerMillion,
      ) +
      tieredTokenCostMicroUsd(
        cacheCreation1hTokens,
        multiplyDecimalString(pricing.inputUsdPerMillion, "2"),
        pricing.inputAbove200kUsdPerMillion
          ? multiplyDecimalString(pricing.inputAbove200kUsdPerMillion, "2")
          : undefined,
      )
    );
  }
  return tieredTokenCostMicroUsd(
    totals.cacheCreationTokens,
    pricing.cacheCreationUsdPerMillion,
    pricing.cacheCreationAbove200kUsdPerMillion,
  );
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
  return normalizeModelId(model, { resolveConfiguredAlias: true });
}

function normalizeModelWithoutConfiguredAlias(model: string): string {
  return normalizeModelId(model, { resolveConfiguredAlias: false });
}

function normalizeModelId(model: string, options: { resolveConfiguredAlias: boolean }): string {
  let cleaned = options.resolveConfiguredAlias ? cleanAndResolveConfiguredAlias(model) : cleanModelId(model);
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

export interface UsageModelNormalization {
  model: string;
  originalModel: string;
  pricingModel?: string;
}

export function normalizeAgentModelForUsage(
  agent: AgentSource,
  model: string | null | undefined,
): UsageModelNormalization {
  const raw = model || "unknown";
  const displayModel = normalizeAgentModel(agent, raw);
  let originalModel = normalizeModelWithoutConfiguredAlias(raw);
  if (agent === "codex") originalModel = stripModelDateSuffix(originalModel) || originalModel;
  originalModel ||= "unknown";

  const useOriginalPricing =
    displayModel !== originalModel && originalModel !== "unknown" && resolvePricing(originalModel) !== null;
  return {
    model: displayModel,
    originalModel,
    ...(useOriginalPricing ? { pricingModel: originalModel } : {}),
  };
}

function pricingCandidates(model: string): string[] {
  const candidates = [
    ...pricingCandidatesForCleanedModel(cleanModelId(model)),
    ...pricingCandidatesForCleanedModel(cleanAndResolveConfiguredAlias(model)),
  ];
  return [...new Set(candidates)];
}

function pricingCandidatesForCleanedModel(cleaned: string): string[] {
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
    const fastStripped = stripFastSuffix(candidate);
    if (fastStripped) queue.push(fastStripped);
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

function cleanAndResolveConfiguredAlias(model: string): string {
  const cleaned = cleanModelId(model);
  return cleanModelId(resolveConfiguredModelAlias(cleaned));
}

function resolveConfiguredModelAlias(model: string): string {
  const aliases = parseConfiguredModelAliases(process.env.CCUSAGE_MODEL_ALIASES || "");
  const exact = aliases.get(model);
  if (exact) return exact;

  const fastBaseModel = stripFastSuffix(model);
  if (fastBaseModel) {
    const baseAlias = aliases.get(fastBaseModel);
    if (baseAlias) return `${baseAlias}-fast`;
  }
  return model;
}

function parseConfiguredModelAliases(raw: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const trimmed = raw.trim();
  if (!trimmed) return aliases;

  const jsonAliases = trimmed.startsWith("{") ? parseJsonModelAliases(trimmed) : null;
  if (jsonAliases) return jsonAliases;

  const stripped = trimmed.startsWith("{") && trimmed.endsWith("}") ? trimmed.slice(1, -1) : trimmed;
  for (const pair of stripped.split(/[,;\n]/)) {
    const [from, ...toParts] = pair.split("=");
    const to = toParts.join("=").trim();
    const normalizedFrom = cleanModelId(from || "");
    const normalizedTo = cleanModelId(to);
    if (normalizedFrom && normalizedTo) aliases.set(normalizedFrom, normalizedTo);
  }
  return aliases;
}

function parseJsonModelAliases(raw: string): Map<string, string> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const aliases = new Map<string, string>();
    for (const [from, to] of Object.entries(parsed)) {
      if (typeof to !== "string") continue;
      const normalizedFrom = cleanModelId(from);
      const normalizedTo = cleanModelId(to);
      if (normalizedFrom && normalizedTo) aliases.set(normalizedFrom, normalizedTo);
    }
    return aliases;
  } catch {
    return null;
  }
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

function stripFastSuffix(model: string): string | null {
  return model.endsWith("-fast") ? model.slice(0, -"-fast".length) : null;
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

function tieredTokenCostMicroUsd(tokens: number, usdPerMillion: string, above200kUsdPerMillion?: string): bigint {
  const safeTokens = Math.max(0, Math.floor(tokens));
  if (!above200kUsdPerMillion || safeTokens <= 200_000) {
    return tokenCostMicroUsd(safeTokens, usdPerMillion);
  }
  return (
    tokenCostMicroUsd(200_000, usdPerMillion) +
    tokenCostMicroUsd(safeTokens - 200_000, above200kUsdPerMillion)
  );
}

function tokenCostMicroUsd(tokens: number, usdPerMillion: string): bigint {
  const rateMicroUsdPerMillion = parseDecimalToMicroUnits(usdPerMillion);
  const safeTokens = BigInt(Math.max(0, Math.floor(tokens)));
  return (safeTokens * rateMicroUsdPerMillion + 500_000n) / 1_000_000n;
}

function applyMultiplier(value: bigint, multiplierMicro: bigint): bigint {
  return (value * multiplierMicro + MICRO_USD_SCALE / 2n) / MICRO_USD_SCALE;
}

function multiplyDecimalString(value: string, multiplier: string): string {
  const left = parseDecimalToMicroUnits(value);
  const right = parseDecimalToMicroUnits(multiplier);
  return formatMicroUsd((left * right + MICRO_USD_SCALE / 2n) / MICRO_USD_SCALE);
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
