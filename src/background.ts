import { collectorShouldYield, yieldPrefix } from "./collector-control.js";
import { watch } from "node:fs";
import { getHttpClient, setHttpClient } from "./http-client.js";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { lock } from "proper-lockfile";
import { tokenUsageDir, readConfig } from "./config.js";
import { collectLocalUsage } from "./file-scan.js";
import { acquireSyncLock, syncLocalUsage } from "./collector.js";
import { publishLocalCache } from "./local-cache.js";

// Keep the CLI compatible with Node 20, including releases before AbortSignal.any.
function joinedSignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  const listeners = new Map<AbortSignal, () => void>();
  const abort = (signal: AbortSignal) => {
    for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
    listeners.clear();
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of new Set(signals)) {
    if (signal.aborted) { abort(signal); break; }
    const listener = () => abort(signal);
    listeners.set(signal, listener);
    signal.addEventListener("abort", listener, { once: true });
  }
  return controller.signal;
}

export async function runBackgroundCollector(options: { signal?: AbortSignal; interval?: number; syncInterval?: number } = {}): Promise<void> {
  const root = tokenUsageDir();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const release = await lock(path.join(root, "background-collector"), { realpath: false, stale: 30_000, update: 5_000, retries: 0 })
    .catch((error: NodeJS.ErrnoException) => { if (error.code === "ELOCKED") return null; throw error; });
  if (!release) return;
  const controller = new AbortController();
  let wake = new AbortController(), cycle = new AbortController();
  const stop = () => { controller.abort(); cycle.abort(); wake.abort(); };
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.signal?.aborted) stop();
  const status = async (error: string | null) => {
    const file = path.join(root, "background-status.json"), tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ pid: process.pid, checkedAt: new Date().toISOString(), error }), { mode: 0o600 });
    await fs.rename(tmp, file);
  };
  let lastSync = 0;
  let uploadError: string | null = null;
  const key = (config: Awaited<ReturnType<typeof readConfig>>) => JSON.stringify([config?.serverUrl, config?.deviceToken, config?.apiToken, config?.autoSyncPaused]);
  let activeAuthorization = key(await readConfig());
  const originalHttp = getHttpClient();
  setHttpClient((input, init) => originalHttp(input, { ...init, signal: joinedSignal([controller.signal, cycle.signal, ...(init?.signal ? [init.signal] : [])]) }));
  const watcher = watch(root, (_event, file) => {
    if (file?.startsWith(yieldPrefix)) { cycle.abort(); wake.abort(); return; }
    if (file !== "config.json") return;
    void readConfig().then(config => {
      if (key(config) !== activeAuthorization) { cycle.abort(); wake.abort(); }
    }).catch(error => process.stderr.write(`Cannot reload collector configuration: ${error.message}\n`));
  });
  try {
    while (!controller.signal.aborted) {
      try {
        cycle.abort();
        cycle = new AbortController();
        const config = await readConfig();
        if (key(config) !== activeAuthorization) { lastSync = 0; uploadError = null; activeAuthorization = key(config); }
        if (!config?.autoSyncPaused && !await collectorShouldYield()) {
          const unlock = await acquireSyncLock();
          if (unlock) try {
            const collection = await collectLocalUsage(process.env.TOKENFLOW_SCAN_HOME, undefined, cycle.signal);
            await publishLocalCache(collection, config);
          } finally { await unlock(); }
          if (!controller.signal.aborted && !cycle.signal.aborted && (config?.deviceToken || config?.apiToken)
            && Date.now() - lastSync >= (options.syncInterval ?? 600_000)) {
            // A failed upload retries at the sync cadence while local collection continues.
            lastSync = Date.now();
            try { await syncLocalUsage({home:process.env.TOKENFLOW_SCAN_HOME,signal:cycle.signal}); uploadError = null; }
            catch (error) {
              if (!controller.signal.aborted && !cycle.signal.aborted) uploadError = error instanceof Error ? error.message : String(error);
              throw error;
            }
          }
        }
        if (uploadError && config?.lastSyncAt && Date.parse(config.lastSyncAt) > lastSync) uploadError = null;
        await status(uploadError);
      } catch (error) {
        if (!controller.signal.aborted && !cycle.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          process.stderr.write(`Background collection failed: ${message}\n`);
          await status(message);
        }
      }
      await delay(options.interval ?? 15_000, undefined, { signal: joinedSignal([controller.signal, wake.signal]) }).catch(error => {
        if (error.name !== "AbortError") throw error;
      });
      wake.abort();
      wake = new AbortController();
    }
  } finally {
    watcher.close();
    setHttpClient(originalHttp);
    process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
    options.signal?.removeEventListener("abort", stop);
    await release();
  }
}
