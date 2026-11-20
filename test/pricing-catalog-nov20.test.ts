import fs from "node:fs";
import { expect, it } from "vitest";
import { parsePricingCatalog } from "../src/server-pricing-catalog.js";
import { resolvePricing, calculateCost } from "../src/pricing.js";

const catalog = parsePricingCatalog(JSON.parse(fs.readFileSync(new URL("./fixtures/pricing-catalog-nov20.json", import.meta.url), "utf8")));
it("uses source identities and explicit plans from the server catalog", () => {
  expect(resolvePricing("gemini-2-5-flash", catalog.profiles)).toMatchObject({ modelId: "google/gemini-2.5-flash", inputUsdPerMillion: "0.3", outputUsdPerMillion: "2.5" });
  expect(resolvePricing("o1", catalog.profiles)).toMatchObject({ inputUsdPerMillion: "15", outputUsdPerMillion: "60" });
  expect(resolvePricing("openrouter/anthropic/claude-opus-4.8-fast", catalog.profiles)).toMatchObject({ modelId: "anthropic/claude-opus-4.8-fast", inputUsdPerMillion: "10" });
  expect(resolvePricing("MiniMaxAI/MiniMax-M3.1-Flash", catalog.profiles)?.cacheReadUsdPerMillion).toBe("0.018");
});
it("retains published duration rates and zero prices through catalog parsing", () => {
  const pricing = resolvePricing("o1", catalog.profiles)!;
  expect(pricing.cacheCreation1hUsdPerMillion).toBe("15");
  expect(calculateCost("codex", { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, cacheCreationTokens: 1000, cacheCreation1hTokens: 1000, totalTokens: 1000 }, pricing).totalUsd).toBe("0.015000");
  expect(resolvePricing("glm-4.7-flash", catalog.profiles)).toMatchObject({ inputUsdPerMillion: "0", outputUsdPerMillion: "0" });
});
