import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { tokenUsageDir, DEFAULT_SERVER_URL, type TokenFlowConfig } from "./config.js";
import { fileVersion } from "./collection-cache.js";
import type { CollectionResult } from "./file-scan.js";
import { readPricingCatalog } from "./server-pricing-catalog.js";
import { summarizeLocal, localDate } from "./local-summary.js";
import { dashboardCache } from "./local-dashboard.js";
import { aggregateEvents } from "./usage-buckets.js";

export async function publishLocalCache(collection: CollectionResult, config: TokenFlowConfig | null, buckets?: ReturnType<typeof aggregateEvents>) {
  const pricing = await readPricingCatalog(config?.serverUrl || DEFAULT_SERVER_URL);
  const profiles = [...pricing?.profiles || [], ...collection.pricingProfiles];
  const root = tokenUsageDir();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const inputRevision = createHash("sha256").update(JSON.stringify([collection.revision || collection.events, profiles, collection.sources, [localDate(new Date()), new Date().getTimezoneOffset()]])).digest("hex");
  const meta = await readJson(path.join(root, "local-cache-meta.json"));
  if (meta?.inputRevision === inputRevision && JSON.stringify(meta.file) === JSON.stringify(await fileVersion(path.join(root, "local-cache.json")))) return meta.summary as ReturnType<typeof summarizeLocal>;
  const summary = summarizeLocal(collection.events, profiles, collection.sources);
  const dashboard = dashboardCache(buckets || aggregateEvents(collection.events, profiles));
  const revision = createHash("sha256").update(JSON.stringify([dashboard.buckets, summary.sources, summary.today.date])).digest("hex");
  const snapshot = { revision, summary, dashboard };
  // Commit one canonical snapshot; keep the protocol-2 files for older Apps.
  for (const [name, value] of [["local-cache.json", snapshot], ["desktop-summary.json", summary], ["desktop-dashboard.json", dashboard]] as const) {
    const file = path.join(root, name), tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(tmp, file);
  }
  const file = path.join(root, "local-cache-meta.json"), tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ inputRevision, revision, summary, file: await fileVersion(path.join(root, "local-cache.json")) }), { mode: 0o600 });
  await fs.rename(tmp, file);
  return summary;
}

async function readJson(file: string): Promise<any | null> {
  const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (error) { if (!(error instanceof SyntaxError)) throw error; return null; }
}
export async function readLocalCache(): Promise<{ summary: ReturnType<typeof summarizeLocal>; dashboard: ReturnType<typeof dashboardCache> } | null> {
  return readJson(path.join(tokenUsageDir(), "local-cache.json"));
}
