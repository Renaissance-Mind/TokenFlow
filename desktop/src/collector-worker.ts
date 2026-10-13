import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { summarizeLocal } from "./summary.js";
import { readEmbeddedSqlite } from "./sqlite.js";
import { net } from "electron";

const runtime = process.env.TOKENFLOW_COLLECTOR_PATH;
if (!runtime || !process.parentPort) throw new Error("Collector worker must be launched by TokenFlow Desktop");
const load = (name: string) => import(pathToFileURL(path.join(runtime, `${name}.js`)).href);
const { collectLocalUsage } = await load("file-scan") as typeof import("../../dist/file-scan.js");
const { readConfig, tokenUsageDir } = await load("config") as typeof import("../../dist/config.js");
const { readPricingCatalog } = await load("server-pricing-catalog") as typeof import("../../dist/server-pricing-catalog.js");
const { aggregateEvents } = await load("usage-buckets") as typeof import("../../dist/usage-buckets.js");
const { syncLocalUsage } = await load("collector") as typeof import("../../dist/collector.js");
const { setSqliteReader } = await load("sources/store-io") as typeof import("../../dist/sources/store-io.js");
const { setHttpClient } = await load("http-client") as typeof import("../../dist/http-client.js");
setHttpClient((input, init) => net.fetch(input as string, init));

setSqliteReader(readEmbeddedSqlite);

let busy = false;
process.parentPort.on("message", async ({ data }: { data: { id: number; action: string } }) => {
  if (busy) { process.parentPort!.postMessage({ id: data.id, error: "Collector is already running" }); return; }
  busy = true;
  try {
    const config = await readConfig();
    const home = process.env.TOKENFLOW_SCAN_HOME;
    let collection;
    let sync = null;
    if (data.action === "sync") {
      sync = await syncLocalUsage({ home });
      if (!sync) throw new Error("Another TokenFlow sync is running. Try again shortly.");
    }
    collection = sync?.collection || await collectLocalUsage(home);
    const pricing = await readPricingCatalog(config?.serverUrl || "https://tokenflow.renaissancemind.ai");
    const summary = await summarizeLocal(collection.events, [...pricing?.profiles || [], ...collection.pricingProfiles], collection.sources, aggregateEvents);
    const cache = path.join(tokenUsageDir(), "desktop-summary.json");
    await fs.mkdir(tokenUsageDir(), { recursive: true });
    const temp = `${cache}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(summary), { mode: 0o600 });
    await fs.rename(temp, cache);
    process.parentPort!.postMessage({ id: data.id, summary, lastSyncAt: sync?.lastSyncAt, warning: sync?.warning,
      uploaded: sync?.uploaded });
  } catch (error) {
    process.parentPort!.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
  } finally { busy = false; }
});
process.parentPort.postMessage({ ready: true });
