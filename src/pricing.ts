import type { AgentSource, CostBreakdown, PricingProfile, PricingRate, UsageTotals } from "./types.js";

const MICRO_USD_SCALE = 1_000_000n;

export const BUILTIN_PRICING: PricingProfile[] = [
  {
    modelId: "gpt-5.5",
    displayName: "GPT-5.5",
    inputUsdPerMillion: "5",
    outputUsdPerMillion: "30",
    cacheReadUsdPerMillion: "0.50",
    cacheCreationUsdPerMillion: "0",
  },
  {
    modelId: "gpt-5.4",
    displayName: "GPT-5.4",
    inputUsdPerMillion: "2.50",
    outputUsdPerMillion: "15",
    cacheReadUsdPerMillion: "0.25",
    cacheCreationUsdPerMillion: "0",
  },
  {
    modelId: "gpt-5.2-codex",
    displayName: "GPT-5.2 Codex",
    inputUsdPerMillion: "1.75",
    outputUsdPerMillion: "14",
    cacheReadUsdPerMillion: "0.175",
    cacheCreationUsdPerMillion: "0",
  },
  {
    modelId: "gpt-5.3-codex",
    displayName: "GPT-5.3 Codex",
    inputUsdPerMillion: "1.75",
    outputUsdPerMillion: "14",
    cacheReadUsdPerMillion: "0.175",
    cacheCreationUsdPerMillion: "0",
  },
  {
    modelId: "claude-opus-4-8",
    displayName: "Claude Opus 4.8",
    inputUsdPerMillion: "5",
    outputUsdPerMillion: "25",
    cacheReadUsdPerMillion: "0.50",
    cacheCreationUsdPerMillion: "6.25",
  },
  {
    modelId: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    inputUsdPerMillion: "5",
    outputUsdPerMillion: "25",
    cacheReadUsdPerMillion: "0.50",
    cacheCreationUsdPerMillion: "6.25",
  },
  {
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    inputUsdPerMillion: "3",
    outputUsdPerMillion: "15",
    cacheReadUsdPerMillion: "0.30",
    cacheCreationUsdPerMillion: "3.75",
  },
  {
    modelId: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    inputUsdPerMillion: "1",
    outputUsdPerMillion: "5",
    cacheReadUsdPerMillion: "0.10",
    cacheCreationUsdPerMillion: "1.25",
  },
  {
    modelId: "gemini-3-pro",
    displayName: "Gemini 3 Pro",
    inputUsdPerMillion: "2",
    outputUsdPerMillion: "12",
    cacheReadUsdPerMillion: "0.20",
    cacheCreationUsdPerMillion: "0",
  },
];

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
  return beforeColon.trim().replaceAll("@", "-").toLowerCase();
}

function stripKnownNamespace(model: string): string | null {
  const claudePos = model.lastIndexOf("claude-");
  if (claudePos > 0) return model.slice(claudePos);

  for (const marker of ["openai.", "anthropic.", "google.", "moonshot.", "moonshotai.", "bedrock.", "global."]) {
    if (model.startsWith(marker)) return model.slice(marker.length);
  }
  return null;
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
