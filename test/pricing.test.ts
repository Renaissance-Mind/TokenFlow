import { describe, expect, it } from "vitest";
import {
  calculateCost,
  normalizeAgentModelForUsage,
  normalizeModelForPricing,
  resolvePricing,
} from "../src/pricing.js";

describe("pricing", () => {
  it("subtracts cache-read tokens from Codex fresh input before applying input price", () => {
    const cost = calculateCost(
      "codex",
      {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 200,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
      },
      {
        inputUsdPerMillion: "3",
        outputUsdPerMillion: "15",
        cacheReadUsdPerMillion: "0.3",
        cacheCreationUsdPerMillion: "3.75",
      },
    );

    expect(cost.inputUsd).toBe("0.001800");
    expect(cost.cacheReadUsd).toBe("0.000120");
    expect(cost.outputUsd).toBe("0.003000");
    expect(cost.totalUsd).toBe("0.004920");
  });

  it("does not subtract cache-read tokens from Claude fresh input", () => {
    const cost = calculateCost(
      "claude",
      {
        inputTokens: 1_000,
        cachedInputTokens: 400,
        outputTokens: 200,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 100,
      },
      {
        inputUsdPerMillion: "3",
        outputUsdPerMillion: "15",
        cacheReadUsdPerMillion: "0.3",
        cacheCreationUsdPerMillion: "3.75",
      },
    );

    expect(cost.inputUsd).toBe("0.003000");
    expect(cost.cacheCreationUsd).toBe("0.000375");
    expect(cost.totalUsd).toBe("0.006495");
  });

  it("normalizes provider prefixes, reasoning suffixes, and date suffixes for pricing lookup", () => {
    expect(normalizeModelForPricing("OpenAI/GPT-5.2-Codex@HIGH-2026-05-14")).toBe(
      "gpt-5.2-codex-high",
    );
    expect(resolvePricing("global.anthropic.claude-sonnet-4-6-20260217-v1:0")?.modelId).toBe(
      "claude-sonnet-4-6-20260217",
    );
  });

  it("honors ccusage model aliases for normalized model names and pricing", () => {
    withCcusageModelAliases("private-alpha=gpt-5.5;private-beta=claude-sonnet-4", () => {
      expect(normalizeModelForPricing("private-alpha")).toBe("gpt-5.5");
      expect(resolvePricing("private-beta")).toMatchObject({
        modelId: "claude-sonnet-4",
        inputUsdPerMillion: "3",
        outputUsdPerMillion: "15",
      });
    });
  });

  it("applies ccusage model aliases to fast-suffixed model names", () => {
    withCcusageModelAliases('{"private-alpha":"gpt-5.5"}', () => {
      expect(normalizeModelForPricing("private-alpha-fast")).toBe("gpt-5.5-fast");
      expect(resolvePricing("private-alpha-fast")).toMatchObject({
        modelId: "gpt-5.5",
      });
    });
  });

  it("exposes ccusage Codex fast pricing multipliers on explicit override models", () => {
    expect(resolvePricing("gpt-5.6")).toMatchObject({
      modelId: "gpt-5.6-sol",
      fastMultiplier: "2",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("gpt-5.6-terra")).toMatchObject({
      modelId: "gpt-5.6-terra",
      fastMultiplier: "2",
    });
    expect(resolvePricing("gpt-5.5-high")).toMatchObject({
      modelId: "gpt-5.5-high",
      fastMultiplier: "2.5",
    });
    expect(resolvePricing("gpt-5.4")).toMatchObject({
      modelId: "gpt-5.4",
      fastMultiplier: "2",
    });
    expect(resolvePricing("gpt-5.3-codex-high")).toMatchObject({
      modelId: "gpt-5.3-codex-high",
      fastMultiplier: "2",
    });
    expect(resolvePricing("gpt-5.2-codex")).not.toMatchObject({
      fastMultiplier: expect.any(String),
    });
  });

  it("prefers priced original models before display aliases", () => {
    withCcusageModelAliases("claude-opus-4-8=mythos-5", () => {
      expect(normalizeModelForPricing("claude-opus-4-8")).toBe("mythos-5");
      expect(resolvePricing("claude-opus-4-8")).toMatchObject({
        modelId: "claude-opus-4-8",
        inputUsdPerMillion: "5",
        outputUsdPerMillion: "25",
      });
    });
  });

  it("resolves cc-switch seed pricing for third-party coding models", () => {
    expect(resolvePricing("moonshotai/kimi-k2-0905:exa")).toMatchObject({
      modelId: "kimi-k2-0905",
      inputUsdPerMillion: "0.55",
      outputUsdPerMillion: "2.20",
    });
    expect(resolvePricing("deepseek-v4-flash")).toMatchObject({
      modelId: "deepseek-v4-flash",
      cacheReadUsdPerMillion: "0.0028",
    });
    expect(resolvePricing("glm-5.1")).toMatchObject({
      modelId: "glm-5.1",
      outputUsdPerMillion: "4.4",
    });
    expect(resolvePricing("minimax-m2.7-highspeed")).toMatchObject({
      modelId: "minimax-m2.7-highspeed",
      cacheCreationUsdPerMillion: "0.375",
    });
    expect(resolvePricing("doubao-seed-code")).toMatchObject({
      modelId: "doubao-seed-code",
      outputUsdPerMillion: "1.11",
    });
  });

  it("resolves Fable 5 and Codex Spark pricing", () => {
    expect(resolvePricing("claude/claude-fable-5")).toMatchObject({
      modelId: "claude-fable-5",
      inputUsdPerMillion: "10",
      outputUsdPerMillion: "50",
      cacheReadUsdPerMillion: "1",
      cacheCreationUsdPerMillion: "12.50",
    });
    expect(resolvePricing("anthropic/claude-fable-latest")).toMatchObject({
      modelId: "claude-fable-latest",
      inputUsdPerMillion: "10",
      outputUsdPerMillion: "50",
      cacheReadUsdPerMillion: "1",
      cacheCreationUsdPerMillion: "12.5",
    });
    expect(resolvePricing("openai/gpt-5.3-codex-spark")).toMatchObject({
      modelId: "gpt-5.3-codex-spark",
      inputUsdPerMillion: "1.75",
      outputUsdPerMillion: "14",
      cacheReadUsdPerMillion: "0.175",
      cacheCreationUsdPerMillion: "0",
    });
  });

  it("resolves ccusage GPT-5.6 pricing with OpenAI long-context tiers", () => {
    expect(resolvePricing("openai/gpt-5.6-sol")).toMatchObject({
      modelId: "gpt-5.6-sol",
      inputUsdPerMillion: "5",
      outputUsdPerMillion: "30",
      cacheCreationUsdPerMillion: "6.25",
      cacheReadUsdPerMillion: "0.50",
      inputAbove200kUsdPerMillion: "10",
      outputAbove200kUsdPerMillion: "45",
      cacheCreationAbove200kUsdPerMillion: "12.50",
      cacheReadAbove200kUsdPerMillion: "1",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("gpt-5.6-terra")).toMatchObject({
      modelId: "gpt-5.6-terra",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "12",
      cacheCreationUsdPerMillion: "2.50",
      cacheReadUsdPerMillion: "0.20",
      inputAbove200kUsdPerMillion: "4",
      outputAbove200kUsdPerMillion: "18",
      cacheCreationAbove200kUsdPerMillion: "5",
      cacheReadAbove200kUsdPerMillion: "0.40",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("gpt-5.6-luna")).toMatchObject({
      modelId: "gpt-5.6-luna",
      inputUsdPerMillion: "0.20",
      outputUsdPerMillion: "1.20",
      cacheCreationUsdPerMillion: "0.25",
      cacheReadUsdPerMillion: "0.02",
      inputAbove200kUsdPerMillion: "0.40",
      outputAbove200kUsdPerMillion: "1.80",
      cacheCreationAbove200kUsdPerMillion: "0.50",
      cacheReadAbove200kUsdPerMillion: "0.04",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("bedrock_mantle/openai.gpt-5.6-terra")).toMatchObject({
      modelId: "bedrock_mantle/openai.gpt-5.6-terra",
      inputUsdPerMillion: "2.20",
      outputUsdPerMillion: "13.20",
      cacheCreationUsdPerMillion: "2.75",
      cacheReadUsdPerMillion: "0.22",
    });
    expect(resolvePricing("bedrock_mantle/openai.gpt-5.6-luna")).toMatchObject({
      modelId: "bedrock_mantle/openai.gpt-5.6-luna",
      inputUsdPerMillion: "0.22",
      outputUsdPerMillion: "1.32",
      cacheCreationUsdPerMillion: "0.275",
      cacheReadUsdPerMillion: "0.022",
    });
    expect(resolvePricing("azure/gpt-5.6-terra")).toMatchObject({
      modelId: "azure/gpt-5.6-terra",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "12",
      cacheCreationUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.20",
    });
    expect(resolvePricing("azure/eu/gpt-5.6-luna")).toMatchObject({
      modelId: "azure/eu/gpt-5.6-luna",
      inputUsdPerMillion: "0.22",
      outputUsdPerMillion: "1.32",
      cacheCreationUsdPerMillion: "0.275",
      cacheReadUsdPerMillion: "0.022",
    });
    expect(resolvePricing("gpt-5.5")).toMatchObject({
      inputAbove200kUsdPerMillion: "10",
      outputAbove200kUsdPerMillion: "45",
      cacheReadAbove200kUsdPerMillion: "1",
      longContextThresholdTokens: 272_000,
    });
  });

  it("prices OpenAI two-stage models as a whole request at the selected tier", () => {
    const pricing = resolvePricing("gpt-5.6-sol");
    expect(pricing).not.toBeNull();

    const long = calculateCost(
      "codex",
      {
        inputTokens: 300_000,
        cachedInputTokens: 100,
        outputTokens: 1_000,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 301_000,
      },
      pricing!,
    );
    expect(long).toMatchObject({
      inputUsd: "2.999000",
      cacheReadUsd: "0.000100",
      outputUsd: "0.045000",
      totalUsd: "3.044100",
    });

    const short = calculateCost(
      "codex",
      {
        inputTokens: 100_000,
        cachedInputTokens: 100,
        outputTokens: 1_000,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 101_000,
      },
      pricing!,
    );
    expect(short).toMatchObject({
      inputUsd: "0.499500",
      cacheReadUsd: "0.000050",
      outputUsd: "0.030000",
      totalUsd: "0.529550",
    });
  });

  it("resolves ccusage Claude short aliases and legacy Claude 3 pricing", () => {
    const aliases = [
      ["claude-opus-4", "15", "75", "1.50", "18.75"],
      ["claude-sonnet-4", "3", "15", "0.30", "3.75"],
      ["claude-opus-4-5", "5", "25", "0.50", "6.25"],
      ["claude-opus-4-6", "5", "25", "0.50", "6.25"],
      ["claude-sonnet-4-6", "3", "15", "0.30", "3.75"],
      ["claude-haiku-4-5", "1", "5", "0.10", "1.25"],
      ["claude-3-7-sonnet-20250219", "3", "15", "0.30", "3.75"],
      ["claude-3-7-sonnet-latest", "3", "15", "0.30", "3.75"],
      ["claude-sonnet-4-5-20250929-thinking", "3", "15", "0.30", "3.75"],
      ["claude-3-opus", "15", "75", "1.50", "18.75"],
      ["claude-3-sonnet", "3", "15", "0.30", "3.75"],
      ["claude-3-haiku", "0.25", "1.25", "0.03", "0.30"],
    ];

    for (const [modelId, input, output, cacheRead, cacheCreation] of aliases) {
      expect(resolvePricing(modelId)).toMatchObject({
        modelId,
        inputUsdPerMillion: input,
        outputUsdPerMillion: output,
        cacheReadUsdPerMillion: cacheRead,
        cacheCreationUsdPerMillion: cacheCreation,
      });
    }

    expect(resolvePricing("claude-sonnet-4")).toMatchObject({
      inputAbove200kUsdPerMillion: "6",
      outputAbove200kUsdPerMillion: "22.5",
      cacheReadAbove200kUsdPerMillion: "0.6",
      cacheCreationAbove200kUsdPerMillion: "7.5",
    });

    expect(resolvePricing("claude-4-5-sonnet")).toMatchObject({
      modelId: "claude-4-5-sonnet",
      inputUsdPerMillion: "2.989",
      outputUsdPerMillion: "14.945",
      cacheReadUsdPerMillion: "0.326",
      cacheCreationUsdPerMillion: "4.078",
    });
    expect(resolvePricing("claude-4-6-sonnet")).toMatchObject({
      modelId: "claude-4-6-sonnet",
      inputUsdPerMillion: "3.196",
      outputUsdPerMillion: "15.94",
      cacheReadUsdPerMillion: "0.32",
      cacheCreationUsdPerMillion: "3.999",
    });
    const rawOpusAliases = [
      ["claude-opus4-5", "5.313", "26.568", "0.531", "6.645"],
      ["claude-opus4-6", "5.313", "26.561", "0.531", "6.645"],
      ["claude-opus4-7", "5.437", "27.186", "0.544", "6.797"],
      ["claude-opus4-8", "5.437", "27.186", "0.544", "6.797"],
    ];
    for (const [modelId, input, output, cacheRead, cacheCreation] of rawOpusAliases) {
      expect(resolvePricing(modelId)).toMatchObject({
        modelId,
        inputUsdPerMillion: input,
        outputUsdPerMillion: output,
        cacheReadUsdPerMillion: cacheRead,
        cacheCreationUsdPerMillion: cacheCreation,
      });
    }
  });

  it("resolves ccusage supplemental Grok and Z.ai pricing entries", () => {
    expect(resolvePricing("grok-4.3")).toMatchObject({
      modelId: "grok-4.3",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "2.50",
      cacheReadUsdPerMillion: "0.125",
      cacheCreationUsdPerMillion: "1.25",
    });
    expect(resolvePricing("zai/glm-4.5-airx")).toMatchObject({
      modelId: "glm-4.5-airx",
      inputUsdPerMillion: "1.10",
      outputUsdPerMillion: "4.50",
      cacheReadUsdPerMillion: "0.22",
    });
    expect(resolvePricing("glm-5-turbo")).toMatchObject({
      modelId: "glm-5-turbo",
      inputUsdPerMillion: "1.20",
      outputUsdPerMillion: "4.00",
      cacheReadUsdPerMillion: "0.24",
    });
    expect(resolvePricing("glm-4.7")).toMatchObject({
      modelId: "glm-4.7",
      inputUsdPerMillion: "0.60",
      outputUsdPerMillion: "2.20",
      cacheReadUsdPerMillion: "0.11",
    });
    expect(resolvePricing("glm-4.6")).toMatchObject({
      modelId: "glm-4.6",
      inputUsdPerMillion: "0.60",
      outputUsdPerMillion: "2.20",
      cacheReadUsdPerMillion: "0.11",
    });
    expect(resolvePricing("replicate/openai/gpt-oss-20b")).toMatchObject({
      modelId: "replicate/openai/gpt-oss-20b",
      inputUsdPerMillion: "0.09",
      outputUsdPerMillion: "0.36",
      cacheReadUsdPerMillion: "0",
      cacheCreationUsdPerMillion: "0",
    });
  });

  it("does not invent per-token pricing for Kimi For Coding plan quotas", () => {
    expect(resolvePricing("kimi-for-coding")).toBeNull();
  });

  it("resolves ccusage embedded models.dev Moonshot/Kimi pricing", () => {
    expect(resolvePricing("moonshot/kimi-k3")).toMatchObject({
      modelId: "kimi-k3",
      inputUsdPerMillion: "3",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.3",
      cacheCreationUsdPerMillion: "3.75",
    });
    expect(resolvePricing("Pro/moonshotai/Kimi-K2.5")).toMatchObject({
      modelId: "pro/moonshotai/kimi-k2.5",
      inputUsdPerMillion: "0.45",
      outputUsdPerMillion: "2.25",
      cacheReadUsdPerMillion: "0.07",
      cacheCreationUsdPerMillion: "0.5625",
    });
    expect(resolvePricing("moonshotai/kimi-k2.5")).toMatchObject({
      modelId: "moonshotai/kimi-k2.5",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "2.8",
      cacheReadUsdPerMillion: "0.125",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("moonshotai/kimi-k2.5:thinking")).toMatchObject({
      modelId: "moonshotai/kimi-k2.5:thinking",
      inputUsdPerMillion: "0.3",
      outputUsdPerMillion: "1.9",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0.375",
    });
    expect(normalizeAgentModelForUsage("kimi", "moonshotai/kimi-k2.5:thinking")).toMatchObject({
      model: "kimi-k2.5",
      pricingModel: "moonshotai/kimi-k2.5:thinking",
    });
    expect(resolvePricing("moonshotai/kimi-k2.6:thinking")).toMatchObject({
      modelId: "moonshotai/kimi-k2.6:thinking",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "2.6",
      cacheReadUsdPerMillion: "0.125",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("moonshotai/Kimi-K2.7-Code")).toMatchObject({
      modelId: "moonshotai/kimi-k2.7-code",
      inputUsdPerMillion: "0.7",
      outputUsdPerMillion: "3.5",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0",
    });
    expect(resolvePricing("kimi-k2-7-code")).toMatchObject({
      modelId: "kimi-k2-7-code",
      inputUsdPerMillion: "0.95",
      outputUsdPerMillion: "4",
      cacheReadUsdPerMillion: "0.95",
      cacheCreationUsdPerMillion: "1.1875",
    });
    expect(resolvePricing("kimi-k2-7-code-highspeed")).toMatchObject({
      modelId: "kimi-k2-7-code-highspeed",
      inputUsdPerMillion: "1.90",
      outputUsdPerMillion: "8",
      cacheReadUsdPerMillion: "1.9",
      cacheCreationUsdPerMillion: "2.375",
    });
    expect(resolvePricing("moonshotai/kimi-k2.7-code-highspeed")).toMatchObject({
      modelId: "kimi-k2.7-code-highspeed",
      inputUsdPerMillion: "1.90",
      outputUsdPerMillion: "8",
      cacheReadUsdPerMillion: "0.38",
    });
    expect(resolvePricing("moonshotai/kimi-k3")).toMatchObject({
      modelId: "moonshotai/kimi-k3",
      inputUsdPerMillion: "3",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.3",
      cacheCreationUsdPerMillion: "3",
    });
    expect(resolvePricing("kimi-k3-fast")).toMatchObject({
      modelId: "kimi-k3-fast",
      inputUsdPerMillion: "4.5",
      outputUsdPerMillion: "22.5",
      cacheReadUsdPerMillion: "0.45",
      cacheCreationUsdPerMillion: "5.625",
    });
    expect(resolvePricing("moonshotai/kimi-k3-fast")).toMatchObject({
      modelId: "moonshotai/kimi-k3-fast",
      inputUsdPerMillion: "4.5",
      outputUsdPerMillion: "22.5",
      cacheReadUsdPerMillion: "0.45",
      cacheCreationUsdPerMillion: "5.625",
    });
    expect(resolvePricing("moonshotai/Kimi-K3-TEE")).toMatchObject({
      modelId: "moonshotai/kimi-k3-tee",
      inputUsdPerMillion: "3",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.3",
      cacheCreationUsdPerMillion: "3.75",
    });
    expect(resolvePricing("TEE/kimi-k3")).toMatchObject({
      modelId: "tee/kimi-k3",
      inputUsdPerMillion: "3",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "1.5",
      cacheCreationUsdPerMillion: "3.75",
    });
    expect(resolvePricing("kimi-k3-eco")).toMatchObject({
      modelId: "kimi-k3-eco",
      inputUsdPerMillion: "1",
      outputUsdPerMillion: "4",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "1.25",
    });
    expect(resolvePricing("moonshot-ai/kimi-k3")).toMatchObject({
      modelId: "kimi-k3",
      inputUsdPerMillion: "3",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.3",
    });
    expect(resolvePricing("moonshot-ai/kimi-k2.7-code")).toMatchObject({
      modelId: "kimi-k2.7-code",
      inputUsdPerMillion: "0.95",
      outputUsdPerMillion: "4",
      cacheReadUsdPerMillion: "0.19",
    });
    expect(resolvePricing("moonshot/kimi-k2.7-code-highspeed")).toMatchObject({
      modelId: "kimi-k2.7-code-highspeed",
      inputUsdPerMillion: "1.90",
      outputUsdPerMillion: "8",
      cacheReadUsdPerMillion: "0.38",
    });
    expect(resolvePricing("kimi-k2.7-code-1100b")).toMatchObject({
      modelId: "kimi-k2.7-code-1100b",
      inputUsdPerMillion: "0.86",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.086",
      cacheCreationUsdPerMillion: "1.075",
    });
    expect(resolvePricing("moonshotai/Kimi-K2.6-Fast")).toMatchObject({
      modelId: "kimi-k2.6-fast",
      inputUsdPerMillion: "0.69",
      outputUsdPerMillion: "3.22",
      cacheReadUsdPerMillion: "0.1725",
    });
    expect(resolvePricing("moonshotai/Kimi-K2.6-TEE")).toMatchObject({
      modelId: "moonshotai/kimi-k2.6-tee",
      inputUsdPerMillion: "0.58",
      outputUsdPerMillion: "3.4",
      cacheReadUsdPerMillion: "0.058",
      cacheCreationUsdPerMillion: "0.725",
    });
    expect(resolvePricing("kimi-k3@eu")).toMatchObject({
      modelId: "kimi-k3-eu",
      inputUsdPerMillion: "2.25",
      outputUsdPerMillion: "11.25",
      cacheReadUsdPerMillion: "0.225",
      cacheCreationUsdPerMillion: "2.8125",
    });
    expect(resolvePricing("moonshotai/kimi-k2-0905")).toMatchObject({
      modelId: "moonshotai/kimi-k2-0905",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0.75",
    });
    expect(resolvePricing("moonshotai/kimi-latest")).toMatchObject({
      modelId: "moonshotai/kimi-latest",
      inputUsdPerMillion: "2.5",
      outputUsdPerMillion: "13.5",
      cacheReadUsdPerMillion: "0.25",
      cacheCreationUsdPerMillion: "3.125",
    });
    expect(resolvePricing("~moonshotai/kimi-latest")).toMatchObject({
      modelId: "~moonshotai/kimi-latest",
      inputUsdPerMillion: "2.9",
      outputUsdPerMillion: "14",
      cacheReadUsdPerMillion: "0.29",
      cacheCreationUsdPerMillion: "3.625",
    });
  });

  it("resolves ccusage Claude Opus 5 models.dev pricing", () => {
    expect(resolvePricing("claude-opus-5")).toMatchObject({
      modelId: "claude-opus-5",
      inputUsdPerMillion: "5",
      outputUsdPerMillion: "25",
      cacheReadUsdPerMillion: "0.50",
      cacheCreationUsdPerMillion: "6.25",
    });
    expect(resolvePricing("claude-opus-5-fast")).toMatchObject({
      modelId: "claude-opus-5-fast",
      inputUsdPerMillion: "12",
      outputUsdPerMillion: "60",
      cacheReadUsdPerMillion: "1.2",
      cacheCreationUsdPerMillion: "15",
    });
    expect(resolvePricing("anthropic/claude-opus-5-fast")).toMatchObject({
      modelId: "anthropic/claude-opus-5-fast",
      inputUsdPerMillion: "10",
      outputUsdPerMillion: "50",
      cacheReadUsdPerMillion: "1",
      cacheCreationUsdPerMillion: "12.5",
    });
    expect(resolvePricing("anthropic/claude-sonnet-latest")).toMatchObject({
      modelId: "claude-sonnet-latest",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "10",
      cacheReadUsdPerMillion: "0.2",
      cacheCreationUsdPerMillion: "2.5",
    });
    expect(resolvePricing("anthropic/claude-sonnet-5:thinking")).toMatchObject({
      modelId: "claude-sonnet-5",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "10",
      cacheReadUsdPerMillion: "0.2",
      cacheCreationUsdPerMillion: "2.5",
    });
    expect(resolvePricing("stealth/claude-opus-4.8")).toMatchObject({
      modelId: "stealth/claude-opus-4.8",
      inputUsdPerMillion: "4",
      outputUsdPerMillion: "20",
      cacheReadUsdPerMillion: "0.4",
      cacheCreationUsdPerMillion: "5",
    });
    expect(resolvePricing("claude-opus-5@eu")).toMatchObject({
      modelId: "claude-opus-5-eu",
      inputUsdPerMillion: "5.5",
      outputUsdPerMillion: "27.5",
      cacheReadUsdPerMillion: "0.55",
      cacheCreationUsdPerMillion: "6.875",
    });
    expect(resolvePricing("claude-sonnet-5@eu")).toMatchObject({
      modelId: "claude-sonnet-5-eu",
      inputUsdPerMillion: "2.2",
      outputUsdPerMillion: "11",
      cacheReadUsdPerMillion: "0.22",
      cacheCreationUsdPerMillion: "2.75",
    });
    expect(resolvePricing("claude-haiku-4-5@eu")).toMatchObject({
      modelId: "claude-haiku-4-5-eu",
      inputUsdPerMillion: "1.1",
      outputUsdPerMillion: "5.5",
      cacheReadUsdPerMillion: "0.11",
      cacheCreationUsdPerMillion: "1.375",
    });
  });

  it("resolves ccusage LiteLLM Gemini Robotics pricing", () => {
    expect(resolvePricing("gemini/gemini-robotics-er-2-preview")).toMatchObject({
      modelId: "gemini-robotics-er-2-preview",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "10",
      cacheReadUsdPerMillion: "0.2",
      cacheCreationUsdPerMillion: "2.5",
    });
    expect(resolvePricing("gemini-robotics-er-1.6-preview")).toMatchObject({
      modelId: "gemini-robotics-er-1.6-preview",
      inputUsdPerMillion: "1",
      outputUsdPerMillion: "5",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "1.25",
    });
  });

  it("prices cache creation duration tiers like ccusage", () => {
    const cost = calculateCost(
      "claude",
      {
        inputTokens: 210_000,
        cachedInputTokens: 20,
        outputTokens: 3,
        reasoningOutputTokens: 2,
        cacheCreationTokens: 30,
        cacheCreation5mTokens: 10,
        cacheCreation1hTokens: 20,
        totalTokens: 210_055,
      },
      {
        inputUsdPerMillion: "1",
        outputUsdPerMillion: "10",
        cacheReadUsdPerMillion: "0.1",
        cacheCreationUsdPerMillion: "1.25",
        inputAbove200kUsdPerMillion: "2",
        outputAbove200kUsdPerMillion: "20",
        cacheCreationAbove200kUsdPerMillion: "1.5",
      },
    );

    expect(cost.inputUsd).toBe("0.220000");
    expect(cost.outputUsd).toBe("0.000050");
    expect(cost.cacheCreationUsd).toBe("0.000053");
    expect(cost.cacheReadUsd).toBe("0.000002");
    expect(cost.totalUsd).toBe("0.220105");
  });
});

function withCcusageModelAliases<T>(value: string, callback: () => T): T {
  const previous = process.env.CCUSAGE_MODEL_ALIASES;
  process.env.CCUSAGE_MODEL_ALIASES = value;
  try {
    return callback();
  } finally {
    if (previous === undefined) delete process.env.CCUSAGE_MODEL_ALIASES;
    else process.env.CCUSAGE_MODEL_ALIASES = previous;
  }
}
