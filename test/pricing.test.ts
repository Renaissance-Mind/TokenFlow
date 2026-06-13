import { describe, expect, it } from "vitest";
import { calculateCost, normalizeModelForPricing, resolvePricing } from "../src/pricing.js";

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
    expect(resolvePricing("openai/gpt-5.3-codex-spark")).toMatchObject({
      modelId: "gpt-5.3-codex-spark",
      inputUsdPerMillion: "1.75",
      outputUsdPerMillion: "14",
      cacheReadUsdPerMillion: "0.175",
      cacheCreationUsdPerMillion: "0",
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
  });

  it("does not invent per-token pricing for Kimi For Coding plan quotas", () => {
    expect(resolvePricing("kimi-for-coding")).toBeNull();
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
