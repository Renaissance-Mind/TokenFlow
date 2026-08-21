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

  it("does not use exact-only pricing rows for prefix fallback", () => {
    expect(
      resolvePricing("gpt-private-preview", [
        {
          modelId: "gpt-private-preview-20260819",
          displayName: "Private Preview",
          inputUsdPerMillion: "1",
          outputUsdPerMillion: "2",
          cacheReadUsdPerMillion: "0.1",
          cacheCreationUsdPerMillion: "1.25",
          exactOnly: true,
        },
      ]),
    ).toBeNull();
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
      cacheReadUsdPerMillion: "0.014",
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
    expect(resolvePricing("anthropic/claude-mythos-5")).toMatchObject({
      modelId: "claude-mythos-5",
      inputUsdPerMillion: "10",
      outputUsdPerMillion: "50",
      cacheReadUsdPerMillion: "1",
      cacheCreationUsdPerMillion: "12.5",
    });
    expect(resolvePricing("claude-mythos-preview")).toMatchObject({
      modelId: "claude-mythos-preview",
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

  it("resolves ccusage GPT-5.1 Codex and chat pricing rows", () => {
    expect(resolvePricing("openai/gpt-5.1-codex-mini")).toMatchObject({
      modelId: "gpt-5.1-codex-mini",
      inputUsdPerMillion: "0.25",
      outputUsdPerMillion: "2",
      cacheReadUsdPerMillion: "0.025",
    });
    expect(resolvePricing("gpt-5.1-chat-latest")).toMatchObject({
      modelId: "gpt-5.1-chat-latest",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "10",
      cacheReadUsdPerMillion: "0.125",
    });
    expect(resolvePricing("gpt-5.1@eu")).toMatchObject({
      modelId: "gpt-5.1-eu",
      inputUsdPerMillion: "1.375",
      outputUsdPerMillion: "11",
      cacheReadUsdPerMillion: "0.1375",
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

    const cachedCodexShort = calculateCost(
      "codex",
      {
        inputTokens: 260_000,
        cachedInputTokens: 20_000,
        outputTokens: 1_000,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 261_000,
      },
      pricing!,
    );
    expect(cachedCodexShort).toMatchObject({
      inputUsd: "1.200000",
      cacheReadUsd: "0.010000",
      outputUsd: "0.030000",
      totalUsd: "1.240000",
    });
  });

  it("selects long-context tiers from the full cached request context", () => {
    const pricing = resolvePricing("grok-4.5");
    expect(pricing).not.toBeNull();

    const cachedHeavy = calculateCost(
      "opencode",
      {
        inputTokens: 10_000,
        cachedInputTokens: 500_000,
        outputTokens: 1_000,
        reasoningOutputTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: 511_000,
      },
      pricing!,
    );
    expect(cachedHeavy).toMatchObject({
      inputUsd: "0.040000",
      cacheReadUsd: "0.300000",
      outputUsd: "0.012000",
      totalUsd: "0.352000",
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
    expect(resolvePricing("anthropic/claude-sonnet-4.6")).toMatchObject({
      modelId: "anthropic/claude-sonnet-4.6",
      inputAbove200kUsdPerMillion: "6",
      outputAbove200kUsdPerMillion: "22.5",
      cacheReadAbove200kUsdPerMillion: "0.6",
      cacheCreationAbove200kUsdPerMillion: "7.5",
      longContextThresholdTokens: 200_000,
    });
    expect(resolvePricing("anthropic/claude-opus-4.7")).toMatchObject({
      modelId: "anthropic/claude-opus-4.7",
      inputAbove200kUsdPerMillion: "10",
      outputAbove200kUsdPerMillion: "37.5",
      cacheReadAbove200kUsdPerMillion: "1",
      cacheCreationAbove200kUsdPerMillion: "12.5",
      longContextThresholdTokens: 200_000,
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
    expect(resolvePricing("xai/grok-4.20-0309-reasoning")).toMatchObject({
      modelId: "grok-4.20-0309-reasoning",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.20",
      inputAbove200kUsdPerMillion: "2.5",
      outputAbove200kUsdPerMillion: "5",
      cacheReadAbove200kUsdPerMillion: "0.4",
    });
    expect(resolvePricing("xai/grok-4.20-beta-0309-non-reasoning")).toMatchObject({
      modelId: "grok-4.20-beta-0309-non-reasoning",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.20",
      inputAbove200kUsdPerMillion: "2.5",
    });
    expect(resolvePricing("xai/grok-4.20-multi-agent-0309")).toMatchObject({
      modelId: "grok-4.20-multi-agent-0309",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "2.5",
    });
    expect(resolvePricing("xai/grok-4.5")).toMatchObject({
      modelId: "grok-4.5",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "6",
      cacheReadUsdPerMillion: "0.30",
      cacheReadAbove200kUsdPerMillion: "0.6",
    });
    expect(resolvePricing("xai/grok-code-fast-1-0825")).toMatchObject({
      modelId: "grok-code-fast-1-0825",
      inputUsdPerMillion: "1",
      outputUsdPerMillion: "2",
      cacheReadUsdPerMillion: "0.20",
      outputAbove200kUsdPerMillion: "4",
    });
    expect(resolvePricing("grok-4.3")).toMatchObject({
      modelId: "grok-4.3",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "2.50",
      cacheReadUsdPerMillion: "0.125",
      cacheCreationUsdPerMillion: "1.25",
    });
    expect(resolvePricing("azure_ai/grok-4.3")).toMatchObject({
      modelId: "azure_ai/grok-4.3",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.20",
      cacheCreationUsdPerMillion: "1.5625",
    });
    expect(normalizeAgentModelForUsage("opencode", "azure_ai/grok-4.3")).toMatchObject({
      model: "grok-4.3",
      pricingModel: "azure_ai/grok-4.3",
    });
    expect(resolvePricing("xai/grok-4.6")).toMatchObject({
      modelId: "grok-4.6",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "6",
      cacheReadUsdPerMillion: "0.50",
      cacheCreationUsdPerMillion: "2.5",
      inputAbove200kUsdPerMillion: "4",
      outputAbove200kUsdPerMillion: "12",
      cacheReadAbove200kUsdPerMillion: "1",
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

  it("resolves new ccusage LiteLLM text-token rows", () => {
    expect(resolvePricing("google/gemini-robotics-er-2-streaming-preview")).toMatchObject({
      modelId: "gemini-robotics-er-2-streaming-preview",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "10",
      cacheReadUsdPerMillion: "0",
      cacheCreationUsdPerMillion: "0",
    });
    expect(resolvePricing("mistral/mistral-small-2603")).toMatchObject({
      modelId: "mistral-small-2603",
      inputUsdPerMillion: "0.15",
      outputUsdPerMillion: "0.6",
      cacheReadUsdPerMillion: "0",
      cacheCreationUsdPerMillion: "0",
    });
    expect(resolvePricing("gemini/gemini-3.7-flash")).toMatchObject({
      modelId: "gemini-3.7-flash",
      inputUsdPerMillion: "0.75",
      outputUsdPerMillion: "3.75",
      cacheReadUsdPerMillion: "0.075",
      cacheCreationUsdPerMillion: "0.9375",
    });
    expect(resolvePricing("azure_ai/FW-Kimi-K2.7-Code")).toMatchObject({
      modelId: "azure_ai/FW-Kimi-K2.7-Code",
      inputUsdPerMillion: "1.05",
      outputUsdPerMillion: "4.4",
      cacheReadUsdPerMillion: "0.21",
      cacheCreationUsdPerMillion: "1.3125",
    });
    expect(normalizeAgentModelForUsage("opencode", "azure_ai/FW-Kimi-K2.7-Code")).toMatchObject({
      model: "fw-kimi-k2.7-code",
      pricingModel: "azure_ai/FW-Kimi-K2.7-Code",
    });
    expect(resolvePricing("meta/muse-spark-1.2-contributor")).toMatchObject({
      modelId: "meta/muse-spark-1.2-contributor",
      inputUsdPerMillion: "0.10",
      outputUsdPerMillion: "0.20",
      cacheReadUsdPerMillion: "0.002",
      cacheCreationUsdPerMillion: "0.125",
    });
    expect(resolvePricing("groq/qwen/qwen3.6-27b")).toMatchObject({
      modelId: "groq/qwen/qwen3.6-27b",
      inputUsdPerMillion: "0.60",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.75",
    });
  });

  it("resolves ccusage models.dev pricing rows updated after v20.0.20", () => {
    expect(resolvePricing("global.openai.gpt-5.6-sol")).toMatchObject({
      modelId: "global.openai.gpt-5.6-sol",
      inputUsdPerMillion: "5.5",
      outputUsdPerMillion: "33",
      cacheReadUsdPerMillion: "0.55",
      cacheCreationUsdPerMillion: "6.875",
      inputAbove200kUsdPerMillion: "11",
      outputAbove200kUsdPerMillion: "49.5",
      cacheReadAbove200kUsdPerMillion: "1.1",
      cacheCreationAbove200kUsdPerMillion: "13.75",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("deepseek-v4-pro-0813")).toMatchObject({
      modelId: "deepseek-v4-pro-0813",
      inputUsdPerMillion: "1.32",
      outputUsdPerMillion: "3.96",
      cacheReadUsdPerMillion: "0.044",
      cacheCreationUsdPerMillion: "1.65",
    });
    expect(resolvePricing("deepseek/deepseek-v4-pro")).toMatchObject({
      modelId: "deepseek/deepseek-v4-pro",
      inputUsdPerMillion: "1.32",
      outputUsdPerMillion: "3.96",
      cacheReadUsdPerMillion: "0.044",
      cacheCreationUsdPerMillion: "0",
    });
    expect(resolvePricing("qwen/deepseek-v4-pro-0813")).toMatchObject({
      modelId: "qwen/deepseek-v4-pro-0813",
      inputUsdPerMillion: "0.726",
      outputUsdPerMillion: "2.178",
      cacheReadUsdPerMillion: "0.0726",
      cacheCreationUsdPerMillion: "0.9075",
    });
    expect(resolvePricing("deepseek-ai/deepseek-v3.1-maas")).toMatchObject({
      modelId: "deepseek-ai/deepseek-v3.1-maas",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "1.7",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.75",
    });
    expect(resolvePricing("qwen/deepseek-v4-flash-0731")).toMatchObject({
      modelId: "qwen/deepseek-v4-flash-0731",
      inputUsdPerMillion: "0.242",
      outputUsdPerMillion: "0.726",
      cacheReadUsdPerMillion: "0.0242",
      cacheCreationUsdPerMillion: "0.3025",
    });
    expect(resolvePricing("deepseek/deepseek-v4-flash-latest")).toMatchObject({
      modelId: "deepseek/deepseek-v4-flash-latest",
      inputUsdPerMillion: "0.14",
      outputUsdPerMillion: "0.28",
      cacheReadUsdPerMillion: "0.028",
      cacheCreationUsdPerMillion: "0.175",
    });
    expect(resolvePricing("deepinfra/deepseek-ai/DeepSeek-V4-Pro-0813")).toMatchObject({
      modelId: "deepinfra/deepseek-ai/DeepSeek-V4-Pro-0813",
      inputUsdPerMillion: "1.3",
      outputUsdPerMillion: "2.6",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "1.625",
    });
    expect(resolvePricing("gemma-4")).toMatchObject({
      modelId: "gemma-4",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "5",
      cacheReadUsdPerMillion: "0.5",
      cacheCreationUsdPerMillion: "2.5",
    });
    expect(resolvePricing("qwen/qwen3.8-27b")).toMatchObject({
      modelId: "qwen/qwen3.8-27b",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("qwen3.8-27b:thinking")).toMatchObject({
      modelId: "qwen3.8-27b:thinking",
      inputUsdPerMillion: "0.2",
      outputUsdPerMillion: "1.4",
      cacheReadUsdPerMillion: "0.04",
      cacheCreationUsdPerMillion: "0.25",
    });
    expect(normalizeAgentModelForUsage("qwen", "qwen3.8-27b:thinking")).toMatchObject({
      model: "qwen3.8-27b",
      pricingModel: "qwen3.8-27b:thinking",
    });
    expect(resolvePricing("qwen3.8-27b")).toMatchObject({
      modelId: "qwen3.8-27b",
      inputUsdPerMillion: "0.334",
      outputUsdPerMillion: "2.451",
      cacheReadUsdPerMillion: "0.111",
      cacheCreationUsdPerMillion: "0.4175",
    });
    expect(resolvePricing("qwen3-8-27b")).toBeNull();
    expect(resolvePricing("qwen-3-8-27b")).toMatchObject({
      modelId: "qwen-3-8-27b",
      inputUsdPerMillion: "0.45",
      outputUsdPerMillion: "3.2",
      cacheReadUsdPerMillion: "0.045",
      cacheCreationUsdPerMillion: "0.5625",
    });
    expect(resolvePricing("Qwen/Qwen3.8-27B")).toMatchObject({
      modelId: "qwen/qwen3.8-27b",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("Qwen/Qwen3.8-27B-TEE")).toMatchObject({
      modelId: "Qwen/Qwen3.8-27B-TEE",
      inputUsdPerMillion: "0.4",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.04",
      cacheCreationUsdPerMillion: "0.5",
    });
    expect(resolvePricing("@cf/qwen/qwen3.8-27b")).toMatchObject({
      modelId: "-cf/qwen/qwen3.8-27b",
      inputUsdPerMillion: "0.45",
      outputUsdPerMillion: "3.2",
      cacheReadUsdPerMillion: "0.05",
      cacheCreationUsdPerMillion: "0.5625",
    });
    expect(resolvePricing("cloudflare/@cf/qwen/qwen3.8-27b")).toMatchObject({
      modelId: "cloudflare/-cf/qwen/qwen3.8-27b",
      inputUsdPerMillion: "0.45",
      outputUsdPerMillion: "3.2",
      cacheReadUsdPerMillion: "0.05",
      cacheCreationUsdPerMillion: "0.5625",
    });
    expect(resolvePricing("alibaba/qwen3.8-27b")).toMatchObject({
      modelId: "alibaba/qwen3.8-27b",
      inputUsdPerMillion: "0.55",
      outputUsdPerMillion: "3.3",
      cacheReadUsdPerMillion: "0.11",
      cacheCreationUsdPerMillion: "0.6875",
    });
    expect(resolvePricing("qwen/qwen3-vl-235b-a22b-thinking")).toMatchObject({
      modelId: "qwen/qwen3-vl-235b-a22b-thinking",
      inputUsdPerMillion: "0.287",
      outputUsdPerMillion: "2.867",
      cacheReadUsdPerMillion: "0.0574",
      cacheCreationUsdPerMillion: "0.35875",
    });
    expect(resolvePricing("seed-2-0-pro")).toMatchObject({
      modelId: "seed-2-0-pro",
      inputUsdPerMillion: "0.63",
      outputUsdPerMillion: "3.79",
      cacheReadUsdPerMillion: "0.63",
      cacheCreationUsdPerMillion: "0.7875",
      inputAbove200kUsdPerMillion: "1.26",
      outputAbove200kUsdPerMillion: "7.58",
      cacheReadAbove200kUsdPerMillion: "1.26",
      longContextThresholdTokens: 128_000,
    });
    expect(resolvePricing("fugu-ultra-v1-1")).toMatchObject({
      modelId: "fugu-ultra-v1-1",
      inputUsdPerMillion: "5",
      outputUsdPerMillion: "30",
      cacheReadUsdPerMillion: "0.5",
      cacheCreationUsdPerMillion: "6.25",
      inputAbove200kUsdPerMillion: "10",
      outputAbove200kUsdPerMillion: "45",
      cacheReadAbove200kUsdPerMillion: "1",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("mimo/mimo-v2.5-pro")).toMatchObject({
      modelId: "mimo-v2.5-pro",
      inputUsdPerMillion: "0.435",
      outputUsdPerMillion: "0.87",
    });
    expect(resolvePricing("~deepseek/deepseek-v4-flash-latest")).toMatchObject({
      modelId: "~deepseek/deepseek-v4-flash-latest",
      inputUsdPerMillion: "0.065",
      outputUsdPerMillion: "0.14",
      cacheReadUsdPerMillion: "0.014",
      cacheCreationUsdPerMillion: "0.08125",
    });
    expect(resolvePricing("tensorx/deepseek/deepseek-v4-flash-0731")).toMatchObject({
      modelId: "tensorx/deepseek/deepseek-v4-flash-0731",
      inputUsdPerMillion: "0.25",
      outputUsdPerMillion: "0.3",
      cacheReadUsdPerMillion: "0.0625",
      cacheCreationUsdPerMillion: "0.3125",
    });
    expect(resolvePricing("tensorx/qwen/qwen3.8-27b")).toMatchObject({
      modelId: "tensorx/qwen/qwen3.8-27b",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("openai/gpt-4o")).toMatchObject({
      modelId: "openai/gpt-4o",
      inputUsdPerMillion: "1.25",
      outputUsdPerMillion: "5",
      cacheReadUsdPerMillion: "0.625",
      cacheCreationUsdPerMillion: "1.5625",
    });
    expect(resolvePricing("openai/gpt-4o-fast")).toMatchObject({
      modelId: "openai/gpt-4o-fast",
      inputUsdPerMillion: "4.25",
      outputUsdPerMillion: "17",
      cacheReadUsdPerMillion: "2.125",
      cacheCreationUsdPerMillion: "5.3125",
    });
    expect(resolvePricing("openai/gpt-5.6-sol-fast")).toMatchObject({
      modelId: "openai/gpt-5.6-sol-fast",
      inputUsdPerMillion: "5",
      outputUsdPerMillion: "30",
      cacheReadUsdPerMillion: "0.5",
      cacheCreationUsdPerMillion: "3.125",
    });
    expect(resolvePricing("openai/gpt-chat-latest")).toMatchObject({
      modelId: "openai/gpt-chat-latest",
      inputUsdPerMillion: "2.5",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.25",
      cacheCreationUsdPerMillion: "3.125",
    });
    expect(resolvePricing("~openai/gpt-latest")).toMatchObject({
      modelId: "~openai/gpt-latest",
      inputUsdPerMillion: "2.5",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.25",
      cacheCreationUsdPerMillion: "3.125",
      inputAbove200kUsdPerMillion: "5",
      outputAbove200kUsdPerMillion: "22.5",
      cacheReadAbove200kUsdPerMillion: "0.5",
      cacheCreationAbove200kUsdPerMillion: "6.25",
      longContextThresholdTokens: 272_000,
    });
    expect(resolvePricing("openai/gpt-5.6-sol-pro")).toMatchObject({
      modelId: "openai/gpt-5.6-sol-pro",
      inputUsdPerMillion: "2.5",
      outputUsdPerMillion: "15",
      cacheReadUsdPerMillion: "0.25",
      inputAbove200kUsdPerMillion: "5",
      outputAbove200kUsdPerMillion: "22.5",
    });
    expect(resolvePricing("openai/gpt-5.6-terra-pro")).toMatchObject({
      modelId: "openai/gpt-5.6-terra-pro",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "12",
      cacheReadAbove200kUsdPerMillion: "0.4",
    });
    expect(resolvePricing("openai/gpt-5.6-luna-pro")).toMatchObject({
      modelId: "openai/gpt-5.6-luna-pro",
      inputUsdPerMillion: "0.2",
      outputUsdPerMillion: "1.2",
      cacheReadAbove200kUsdPerMillion: "0.04",
    });
    expect(resolvePricing("glm-5.2-fast")).toMatchObject({
      modelId: "glm-5.2-fast",
      inputUsdPerMillion: "1.99",
      outputUsdPerMillion: "6.16",
      cacheReadUsdPerMillion: "0.4",
      cacheCreationUsdPerMillion: "2.4875",
    });
    expect(resolvePricing("ionos/openai/gpt-oss-120b")).toMatchObject({
      modelId: "ionos/openai/gpt-oss-120b",
      inputUsdPerMillion: "0.175215",
      outputUsdPerMillion: "0.759265",
      cacheReadUsdPerMillion: "0.0175215",
      cacheCreationUsdPerMillion: "0.21901875",
    });
    expect(resolvePricing("ionos/meta-llama/Llama-3.3-70B-Instruct")).toMatchObject({
      modelId: "ionos/meta-llama/Llama-3.3-70B-Instruct",
      inputUsdPerMillion: "0.759265",
      outputUsdPerMillion: "0.759265",
      cacheReadUsdPerMillion: "0.0759265",
      cacheCreationUsdPerMillion: "0.94908125",
    });
    expect(resolvePricing("scaleway/deepseek-v4-flash-0731")).toMatchObject({
      modelId: "scaleway/deepseek-v4-flash-0731",
      inputUsdPerMillion: "0.46724",
      outputUsdPerMillion: "0.93448",
      cacheReadUsdPerMillion: "0.046724",
      cacheCreationUsdPerMillion: "0.58405",
    });
    expect(resolvePricing("scaleway/gpt-oss-120b")).toMatchObject({
      modelId: "scaleway/gpt-oss-120b",
      inputUsdPerMillion: "0.175215",
      outputUsdPerMillion: "0.70086",
      cacheReadUsdPerMillion: "0.0175215",
      cacheCreationUsdPerMillion: "0.21901875",
    });
    expect(resolvePricing("scaleway/llama-3.3-70b-instruct")).toMatchObject({
      modelId: "scaleway/llama-3.3-70b-instruct",
      inputUsdPerMillion: "1.05129",
      outputUsdPerMillion: "1.05129",
      cacheReadUsdPerMillion: "0.105129",
      cacheCreationUsdPerMillion: "1.3141125",
    });
    expect(resolvePricing("nebius/openai/gpt-oss-120b")).toMatchObject({
      modelId: "nebius/openai/gpt-oss-120b",
      inputUsdPerMillion: "0.15",
      outputUsdPerMillion: "0.6",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0.1875",
    });
    expect(resolvePricing("trinity-large-thinking")).toMatchObject({
      modelId: "trinity-large-thinking",
      inputUsdPerMillion: "0.25",
      outputUsdPerMillion: "0.8",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.3125",
    });
    expect(resolvePricing("meta/muse-glimmer-30b")).toMatchObject({
      modelId: "meta/muse-glimmer-30b",
      inputUsdPerMillion: "0.3",
      outputUsdPerMillion: "1.1",
      cacheReadUsdPerMillion: "0.04",
      cacheCreationUsdPerMillion: "0.375",
    });
    expect(resolvePricing("mistralai/ministral-8b")).toMatchObject({
      modelId: "mistralai/ministral-8b",
      inputUsdPerMillion: "0.11",
      outputUsdPerMillion: "0.11",
      cacheReadUsdPerMillion: "0.011",
      cacheCreationUsdPerMillion: "0.1375",
    });
    expect(resolvePricing("moonshotai/kimi-k2-thinking-maas")).toMatchObject({
      modelId: "moonshotai/kimi-k2-thinking-maas",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.75",
    });
    expect(resolvePricing("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16")).toMatchObject({
      modelId: "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "0.5",
      cacheReadUsdPerMillion: "0.5",
      cacheCreationUsdPerMillion: "0.5",
    });
    expect(resolvePricing("openai/gpt-oss-20b-maas")).toMatchObject({
      modelId: "openai/gpt-oss-20b-maas",
      inputUsdPerMillion: "0.07",
      outputUsdPerMillion: "0.25",
      cacheReadUsdPerMillion: "0.007",
      cacheCreationUsdPerMillion: "0.0875",
    });
    expect(resolvePricing("ornith-ai/ornith-1.5-35b-a3b:thinking")).toMatchObject({
      modelId: "ornith-ai/ornith-1.5-35b-a3b:thinking",
      inputUsdPerMillion: "0.1",
      outputUsdPerMillion: "0.4",
      cacheReadUsdPerMillion: "0.01",
      cacheCreationUsdPerMillion: "0.125",
    });
    expect(resolvePricing("tencent/hy-mt2-30b-a3b")).toMatchObject({
      modelId: "tencent/hy-mt2-30b-a3b",
      inputUsdPerMillion: "0.074",
      outputUsdPerMillion: "0.295",
      cacheReadUsdPerMillion: "0.0074",
      cacheCreationUsdPerMillion: "0.0925",
    });
    expect(resolvePricing("zai-org/glm-4.7-maas")).toMatchObject({
      modelId: "zai-org/glm-4.7-maas",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "2.2",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.75",
    });
    expect(resolvePricing("nemotron-3-ultra-550b")).toMatchObject({
      modelId: "nemotron-3-ultra-550b",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "2.2",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("ambient/large")).toMatchObject({
      modelId: "ambient/large",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "2",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0",
    });
    expect(resolvePricing("sakana-namazu")).toMatchObject({
      modelId: "sakana-namazu",
      inputUsdPerMillion: "0.95",
      outputUsdPerMillion: "4",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "1.1875",
    });
    expect(resolvePricing("z-ai/glm-5.3")).toMatchObject({
      modelId: "z-ai/glm-5.3",
      inputUsdPerMillion: "1.2",
      outputUsdPerMillion: "4.4",
      cacheReadUsdPerMillion: "0.3",
      cacheCreationUsdPerMillion: "1.2",
    });
    expect(resolvePricing("deepseek-v4-pro")).toMatchObject({
      modelId: "deepseek-v4-pro",
      inputUsdPerMillion: "1.32",
      outputUsdPerMillion: "3.96",
      cacheReadUsdPerMillion: "0.044",
      cacheCreationUsdPerMillion: "0",
    });
    expect(resolvePricing("TEE/deepseek-v4-pro-0813")).toMatchObject({
      modelId: "deepseek-v4-pro-0813",
      inputUsdPerMillion: "1.32",
      outputUsdPerMillion: "3.96",
      cacheReadUsdPerMillion: "0.044",
      cacheCreationUsdPerMillion: "1.65",
    });
    expect(resolvePricing("qwen/qwen3.8-27b")).toMatchObject({
      modelId: "qwen/qwen3.8-27b",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.1",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("Qwen/Qwen3.8-27B-TEE")).toMatchObject({
      modelId: "Qwen/Qwen3.8-27B-TEE",
      inputUsdPerMillion: "0.4",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.04",
      cacheCreationUsdPerMillion: "0.5",
    });
    expect(resolvePricing("google/gemini-3.7-flash")).toMatchObject({
      modelId: "google/gemini-3.7-flash",
      inputUsdPerMillion: "1.5",
      outputUsdPerMillion: "7.5",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0.083333",
    });
    expect(resolvePricing("grok-4.2-beta")).toMatchObject({
      modelId: "grok-4.2-beta",
      inputUsdPerMillion: "2",
      outputUsdPerMillion: "6",
      cacheReadUsdPerMillion: "0.2",
      cacheCreationUsdPerMillion: "2",
      inputAbove200kUsdPerMillion: "4",
      outputAbove200kUsdPerMillion: "12",
      cacheReadAbove200kUsdPerMillion: "0.4",
      cacheCreationAbove200kUsdPerMillion: "4",
      longContextThresholdTokens: 200_000,
    });
    expect(resolvePricing("databricks/databricks-gpt-5-2")).toMatchObject({
      modelId: "databricks/databricks-gpt-5-2",
      inputUsdPerMillion: "1.75",
      outputUsdPerMillion: "14",
      cacheReadUsdPerMillion: "0.175",
      cacheCreationUsdPerMillion: "2.1875",
    });
    expect(resolvePricing("echo")).toMatchObject({
      modelId: "echo",
      inputUsdPerMillion: "10",
      outputUsdPerMillion: "50",
      cacheReadUsdPerMillion: "1",
      cacheCreationUsdPerMillion: "12.5",
      exactOnly: true,
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
    expect(resolvePricing("TEE/kimi-k2.5")).toMatchObject({
      modelId: "kimi-k2.5",
      cacheReadUsdPerMillion: "0.10",
    });
    expect(resolvePricing("TEE/kimi-k2.5-thinking")).toBeNull();
    expect(resolvePricing("moonshotai/kimi-k2.6:thinking")).toMatchObject({
      modelId: "moonshotai/kimi-k2.6:thinking",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "2.6",
      cacheReadUsdPerMillion: "0.125",
      cacheCreationUsdPerMillion: "0.625",
    });
    expect(resolvePricing("moonshotai/Kimi-K2.6")).toMatchObject({
      modelId: "moonshotai/Kimi-K2.6",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "3.41",
      cacheReadUsdPerMillion: "0.2",
      cacheCreationUsdPerMillion: "0",
    });
    expect(normalizeAgentModelForUsage("kimi", "moonshotai/Kimi-K2.6")).toMatchObject({
      model: "kimi-k2.6",
      pricingModel: "moonshotai/Kimi-K2.6",
    });
    expect(resolvePricing("moonshotai/Kimi-K2.7-Code")).toMatchObject({
      modelId: "moonshotai/Kimi-K2.7-Code",
      inputUsdPerMillion: "0.67",
      outputUsdPerMillion: "3.4",
      cacheReadUsdPerMillion: "0.15",
      cacheCreationUsdPerMillion: "0",
    });
    expect(normalizeAgentModelForUsage("kimi", "moonshotai/Kimi-K2.7-Code")).toMatchObject({
      model: "kimi-k2.7-code",
      pricingModel: "moonshotai/Kimi-K2.7-Code",
    });
    expect(resolvePricing("moonshotai/kimi-k2.7-code")).toMatchObject({
      modelId: "moonshotai/kimi-k2.7-code",
      inputUsdPerMillion: "0.69",
      outputUsdPerMillion: "3.49",
      cacheReadUsdPerMillion: "0.14",
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
      modelId: "moonshotai/Kimi-K2.6",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "3.41",
      cacheReadUsdPerMillion: "0.2",
    });
    expect(normalizeAgentModelForUsage("kimi", "moonshotai/Kimi-K2.6-Fast")).toMatchObject({
      model: "kimi-k2.6-fast",
      pricingModel: "moonshotai/Kimi-K2.6",
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
    expect(resolvePricing("amazon/moonshot.kimi-k2-thinking")).toMatchObject({
      modelId: "amazon/moonshot.kimi-k2-thinking",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "2.5",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.75",
    });
    expect(resolvePricing("amazon/moonshotai.kimi-k2.5")).toMatchObject({
      modelId: "amazon/moonshotai.kimi-k2.5",
      inputUsdPerMillion: "0.6",
      outputUsdPerMillion: "3",
      cacheReadUsdPerMillion: "0.06",
      cacheCreationUsdPerMillion: "0.75",
    });
    expect(resolvePricing("moonshotai/kimi-latest")).toMatchObject({
      modelId: "moonshotai/kimi-latest",
      inputUsdPerMillion: "2.5",
      outputUsdPerMillion: "13.5",
      cacheReadUsdPerMillion: "0.25",
      cacheCreationUsdPerMillion: "3.125",
    });
    expect(resolvePricing("kimi-latest")).toMatchObject({
      modelId: "kimi-latest",
      inputUsdPerMillion: "1.791",
      outputUsdPerMillion: "8.9436",
      cacheReadUsdPerMillion: "0.1733",
      cacheCreationUsdPerMillion: "2.23875",
    });
    expect(resolvePricing("~moonshotai/kimi-latest")).toMatchObject({
      modelId: "~moonshotai/kimi-latest",
      inputUsdPerMillion: "2.6",
      outputUsdPerMillion: "13",
      cacheReadUsdPerMillion: "0.29",
      cacheCreationUsdPerMillion: "3.25",
    });
    expect(resolvePricing("deepinfra/moonshotai/Kimi-K2.5")).toMatchObject({
      modelId: "deepinfra/moonshotai/Kimi-K2.5",
      inputUsdPerMillion: "0.45",
      outputUsdPerMillion: "2.25",
      cacheReadUsdPerMillion: "0.07",
      cacheCreationUsdPerMillion: "0.5625",
    });
    expect(resolvePricing("workers-ai/@cf/moonshotai/kimi-k2.7-code")).toMatchObject({
      modelId: "workers-ai/-cf/moonshotai/kimi-k2.7-code",
      inputUsdPerMillion: "0.95",
      outputUsdPerMillion: "4",
      cacheReadUsdPerMillion: "0.19",
      cacheCreationUsdPerMillion: "1.1875",
    });
    expect(resolvePricing("tensorx/moonshotai/kimi-k2.5")).toMatchObject({
      modelId: "tensorx/moonshotai/kimi-k2.5",
      inputUsdPerMillion: "0.5",
      outputUsdPerMillion: "2.8",
      cacheReadUsdPerMillion: "0.125",
      cacheCreationUsdPerMillion: "0.625",
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
