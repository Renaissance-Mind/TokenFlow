import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { tokenUsageDir } from "./config.js";
import type { PricingProfile } from "./types.js";

export interface PricingCatalog {
  version: string;
  profiles: PricingProfile[];
}
const rateFields = [
  "inputUsdPerMillion",
  "outputUsdPerMillion",
  "cacheReadUsdPerMillion",
  "cacheCreationUsdPerMillion",
  "inputAbove200kUsdPerMillion",
  "outputAbove200kUsdPerMillion",
  "cacheReadAbove200kUsdPerMillion",
  "cacheCreationAbove200kUsdPerMillion",
  "fastMultiplier",
] as const;

export function parsePricingCatalog(value: unknown): PricingCatalog {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid server pricing catalog");
  const catalog = value as Record<string, unknown>;
  if (
    typeof catalog.version !== "string" ||
    !catalog.version ||
    !Array.isArray(catalog.profiles)
  )
    throw new Error("Invalid server pricing catalog version/profiles");
  const profiles = catalog.profiles.map((raw: unknown): PricingProfile => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Invalid server pricing profile");
    const row = raw as Record<string, unknown>;
    if (
      typeof row.modelId !== "string" ||
      !row.modelId ||
      typeof row.displayName !== "string"
    )
      throw new Error("Invalid server pricing model identity");
    const profile: Record<string, unknown> = {
      modelId: row.modelId,
      displayName: row.displayName,
    };
    for (const key of rateFields) {
      const rate = row[key];
      if (rate === undefined && rateFields.indexOf(key) >= 4) continue;
      if (
        typeof rate !== "string" ||
        !rate.trim() ||
        !Number.isFinite(Number(rate)) ||
        Number(rate) < 0
      )
        throw new Error(`Invalid server pricing rate: ${key}`);
      profile[key] = rate;
    }
    if (row.longContextThresholdTokens !== undefined) {
      if (
        typeof row.longContextThresholdTokens !== "number" ||
        !Number.isSafeInteger(row.longContextThresholdTokens) ||
        row.longContextThresholdTokens <= 0
      )
        throw new Error("Invalid server pricing context threshold");
      profile.longContextThresholdTokens = row.longContextThresholdTokens;
    }
    if (row.exactOnly === true) profile.exactOnly = true;
    return profile as unknown as PricingProfile;
  });
  return { version: catalog.version, profiles };
}

function catalogPath(home: string) {
  return path.join(tokenUsageDir(home), "pricing-catalog.json");
}

export async function readPricingCatalog(
  serverUrl: string,
  home = os.homedir(),
): Promise<PricingCatalog | null> {
  const raw = await fs
    .readFile(catalogPath(home), "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (!raw) return null;
  const stored = JSON.parse(raw) as { serverUrl?: string; catalog?: unknown };
  return stored.serverUrl === serverUrl
    ? parsePricingCatalog(stored.catalog)
    : null;
}

export async function writePricingCatalog(
  serverUrl: string,
  catalog: PricingCatalog,
  home = os.homedir(),
): Promise<void> {
  const file = catalogPath(home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(
    temporary,
    JSON.stringify({ serverUrl, catalog: parsePricingCatalog(catalog) }),
    { mode: 0o600 },
  );
  await fs.rename(temporary, file);
}

export async function refreshPricingCatalog(
  serverUrl: string,
  home = os.homedir(),
): Promise<{ catalog: PricingCatalog | null; warning?: string }> {
  const cached = await readPricingCatalog(serverUrl, home);
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/pricing/catalog`, {
      headers: cached ? { "If-None-Match": `"${cached.version}"` } : {},
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    return {
      catalog: cached,
      warning: `Server pricing catalog unavailable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (response.status === 304 && cached) return { catalog: cached };
  if (response.status === 404) return { catalog: cached };
  if (!response.ok)
    return {
      catalog: cached,
      warning: `Server pricing catalog returned HTTP ${response.status}`,
    };
  const catalog = parsePricingCatalog(await response.json());
  await writePricingCatalog(serverUrl, catalog, home);
  return { catalog };
}
