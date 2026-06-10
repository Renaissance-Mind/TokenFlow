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

  it("does not invent per-token pricing for Kimi For Coding plan quotas", () => {
    expect(resolvePricing("kimi-for-coding")).toBeNull();
  });
});
