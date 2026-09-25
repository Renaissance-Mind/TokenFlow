#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || value === undefined) {
    throw new Error("Usage: generate-ccusage-pricing-data --ccusage-dir DIR --litellm-json FILE --output FILE");
  }
  args.set(key.slice(2), value);
}

const ccusageDir = requiredArg("ccusage-dir");
const litellmPath = requiredArg("litellm-json");
const outputPath = requiredArg("output");
const modelsDevPath = path.join(ccusageDir, "rust/crates/ccusage-core/src/models-dev-pricing.json");
const flakeLockPath = path.join(ccusageDir, "flake.lock");

const ccusageCommit = execGit(ccusageDir, ["rev-parse", "HEAD"]);
const flakeLock = readJson(flakeLockPath);
const litellmSnapshot = flakeLock.nodes?.litellm?.locked?.rev;
const modelsDevSnapshot = flakeLock.nodes?.["models-dev"]?.locked?.rev;
if (!litellmSnapshot || !modelsDevSnapshot) {
  throw new Error("ccusage flake.lock is missing LiteLLM or models.dev revisions");
}

const fastMultiplierOverrides = readJson(path.join(ccusageDir, "rust/crates/ccusage-core/src/fast-multiplier-overrides.json"));

const rows = [
  ...loadLiteLlmRows(readJson(litellmPath)),
  ...loadModelsDevRows(readJson(modelsDevPath)),
].sort((left, right) => left.modelId.localeCompare(right.modelId));

const chunks = [];
const chunkSize = 500;
for (let index = 0; index < rows.length; index += chunkSize) {
  chunks.push(rows.slice(index, index + chunkSize));
}

const body = chunks
  .map((chunk) => `[\n${chunk.map((row) => `  ${JSON.stringify(row)}`).join(",\n")}\n]`)
  .join(",\n");

const output = `import type { PricingProfile } from "./types.js";

// Generated from ccusage ${ccusageCommit}.
// LiteLLM snapshot: ${litellmSnapshot}.
// models.dev snapshot: ${modelsDevSnapshot}.
// Regenerate during the daily ccusage pricing parity automation; do not edit by hand.
export const CCUSAGE_SNAPSHOT_PRICING: PricingProfile[] = ([] as PricingProfile[]).concat(
${body}
);
`;

fs.writeFileSync(outputPath, output);
console.log(`Wrote ${rows.length} ccusage pricing rows to ${outputPath}`);

function requiredArg(name) {
  const value = args.get(name);
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function execGit(cwd, gitArgs) {
  const result = spawnSync("git", gitArgs, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git ${gitArgs.join(" ")} failed`);
  return result.stdout.trim();
}

function loadLiteLlmRows(raw) {
  const rows = [];
  for (const [modelId, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    const input = numberField(value, "input_cost_per_token");
    const output = numberField(value, "output_cost_per_token");
    if (input === undefined || output === undefined) continue;

    const row = {
      modelId,
      displayName: displayName(modelId),
      inputUsdPerMillion: perMillion(input),
      outputUsdPerMillion: perMillion(output),
      cacheReadUsdPerMillion: perMillion(numberField(value, "cache_read_input_token_cost") ?? input * 0.1),
      cacheCreationUsdPerMillion: perMillion(
        numberField(value, "cache_creation_input_token_cost") ?? input * 1.25,
      ),
    };
    assignPerMillion(row, "inputAbove200kUsdPerMillion", numberField(value, "input_cost_per_token_above_200k_tokens"));
    assignPerMillion(row, "outputAbove200kUsdPerMillion", numberField(value, "output_cost_per_token_above_200k_tokens"));
    assignPerMillion(
      row,
      "cacheReadAbove200kUsdPerMillion",
      numberField(value, "cache_read_input_token_cost_above_200k_tokens"),
    );
    assignPerMillion(
      row,
      "cacheCreationAbove200kUsdPerMillion",
      numberField(value, "cache_creation_input_token_cost_above_200k_tokens"),
    );
    const fastMultiplier = value.provider_specific_entry?.fast ?? multiplierFor(modelId);
    if (fastMultiplier !== undefined) row.fastMultiplier = decimal(Number(fastMultiplier));
    rows.push(row);
  }
  return rows;
}

function loadModelsDevRows(raw) {
  const rows = [];
  for (const [modelId, value] of Object.entries(raw)) {
    if (!isRecord(value) || !isRecord(value.cost)) continue;
    const input = numberField(value.cost, "input");
    const output = numberField(value.cost, "output");
    if (input === undefined || output === undefined) continue;

    const cacheRead = numberField(value.cost, "cache_read") ?? input * 0.1;
    const cacheCreation = numberField(value.cost, "cache_write") ?? input * 1.25;
    const row = {
      modelId,
      displayName: displayName(modelId),
      inputUsdPerMillion: decimal(input),
      outputUsdPerMillion: decimal(output),
      cacheReadUsdPerMillion: decimal(cacheRead),
      cacheCreationUsdPerMillion: decimal(cacheCreation),
    };

    const tier = firstContextTier(value.cost.tiers);
    if (tier) {
      assignDecimal(row, "inputAbove200kUsdPerMillion", tier.input);
      assignDecimal(row, "outputAbove200kUsdPerMillion", tier.output);
      assignDecimal(row, "cacheReadAbove200kUsdPerMillion", tier.cache_read);
      assignDecimal(row, "cacheCreationAbove200kUsdPerMillion", tier.cache_write);
      row.longContextThresholdTokens = tier.tier.size;
    }
    if (value.exactOnly === true) row.exactOnly = true;
    const fastMultiplier = multiplierFor(modelId);
    if (fastMultiplier !== undefined) row.fastMultiplier = decimal(Number(fastMultiplier));
    rows.push(row);
  }
  return rows;
}

function firstContextTier(tiers) {
  if (!Array.isArray(tiers)) return null;
  return tiers
    .filter((tier) => isRecord(tier) && tier.tier?.type === "context" && Number(tier.tier.size) > 0)
    .sort((left, right) => Number(left.tier.size) - Number(right.tier.size))[0] ?? null;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function numberField(record, key) {
  const value = Number(record[key]);
  return Number.isFinite(value) ? value : undefined;
}

function assignPerMillion(row, key, value) {
  if (value !== undefined) row[key] = perMillion(value);
}

function assignDecimal(row, key, value) {
  if (value !== undefined && value !== null) row[key] = decimal(Number(value));
}

function perMillion(value) {
  return decimal(value * 1_000_000);
}

function decimal(value) {
  if (!Number.isFinite(value)) throw new Error(`Invalid numeric pricing value: ${value}`);
  return String(Number(value.toPrecision(15)));
}

function displayName(modelId) {
  return modelId
    .split("/")
    .at(-1)
    .replace(/^@cf\//, "")
    .replace(/[:._@-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function multiplierFor(modelId) {
  const exact = fastMultiplierOverrides.exact ?? {};
  if (exact[modelId] !== undefined) return exact[modelId];
  const alias = pricingAlias(modelId);
  if (alias && exact[alias] !== undefined) return exact[alias];
  for (const part of modelId.split(/[/:]/)) {
    if (exact[part] !== undefined) return exact[part];
    const partAlias = pricingAlias(part);
    if (partAlias && exact[partAlias] !== undefined) return exact[partAlias];
    const normalized = part.replace(/[.@]/g, "-");
    for (const [base, multiplier] of Object.entries(fastMultiplierOverrides.normalized_prefix ?? {})) {
      if (matchesModelSuffix(normalized, base)) return multiplier;
    }
  }
  return undefined;
}

function pricingAlias(modelId) {
  switch (modelId) {
    case "gpt-reserve":
      return "gpt-5.6-luna";
    case "gpt-5.6":
      return "gpt-5.6-sol";
    case "gpt-5.3-spark":
      return "gpt-5.3-codex-spark";
    default:
      return undefined;
  }
}

function matchesModelSuffix(part, base) {
  const index = part.lastIndexOf(base);
  if (index === -1) return false;
  const suffix = part.slice(index);
  return suffix === base || suffix.charAt(base.length) === "-";
}
