import { requestCollectorYield } from "./collector-control.js";
import { readLocalCache, publishLocalCache } from "./local-cache.js";
import type { ScanProgress } from "./scan-progress.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { acquireSyncLock, syncLocalUsageWithHeldLock } from "./collector.js";
import { readConfig, tokenUsageDir, writeConfig, DEFAULT_SERVER_URL } from "./config.js";
import { collectLocalUsage } from "./file-scan.js";
import { localDashboardApi } from "./local-dashboard.js";
import { aggregateEvents } from "./usage-buckets.js";
import { getUploadApiTokenStatus, getDeviceStatus, renameDevice } from "./api.js";
import { installAutoSync } from "./scheduler.js";
import { setHttpClient } from "./http-client.js";
import { initializeSqliteReader } from "./sources/store-io.js";

// Private stdio protocol, shared by npm installs and App-installed CLIs.
// Credentials stay on stdin/stdout between the two local processes.
export async function desktopAction(action: string, params: Record<string, any> = {}, phase = (_value: string) => {}, progress?: (value: ScanProgress) => void): Promise<unknown> {
  if (action === "dashboard") {
    const snapshot = await readLocalCache();
    if (snapshot) return localDashboardApi(snapshot.dashboard, await readConfig(), params.path);
    const file = await fs.readFile(path.join(tokenUsageDir(), "desktop-dashboard.json"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    return localDashboardApi(file ? JSON.parse(file) : null, await readConfig(), params.path);
  }
  if (action === "state") {
    const config = await readConfig();
    const backgroundText = await fs.readFile(path.join(tokenUsageDir(), "background-status.json"), "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    const background = backgroundText ? JSON.parse(backgroundText) : null;
    const snapshot = await readLocalCache();
    if (snapshot) return { config, home: tokenUsageDir(), summary: snapshot.summary, background };
    const cache = await fs.readFile(path.join(tokenUsageDir(), "desktop-summary.json"), "utf8").catch(() => null);
    return { config, home: tokenUsageDir(), summary: cache ? JSON.parse(cache) : null, background };
  }
  if (action === "owner") {
    const file = path.join(tokenUsageDir(), "desktop-agent.json");
    if (params.pid) { await fs.mkdir(tokenUsageDir(), { recursive: true }); await fs.writeFile(file, JSON.stringify({ pid: params.pid, updatedAt: new Date().toISOString() })); }
    else await fs.rm(file, { force: true });
    return {};
  }
  if (action === "scheduler") {
    const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
    return installAutoSync(params.serverUrl || (await readConfig())?.serverUrl || DEFAULT_SERVER_URL, os.homedir(), {
      env: { ...process.env, TOKENFLOW_AUTO_SYNC_COMMAND: `TOKENFLOW_HOME=${quote(tokenUsageDir())} ${quote(process.execPath)} ${quote(fileURLToPath(new URL("cli.js", import.meta.url)))} collect --watch` },
    });
  }
  if (action === "account") {
    const config = await readConfig();
    if (config?.apiToken) return { apiToken: config.apiToken, account: (await getUploadApiTokenStatus(config.serverUrl, config.apiToken)).account };
    if (config?.deviceToken) return { device: await getDeviceStatus(config.serverUrl, config.deviceToken) };
    return {};
  }
  let release: (() => Promise<void>) | null = null;
  let resume: (() => Promise<void>) | null = null;
  const unlock = async () => { const owned = release; release = null; if (owned) await owned(); const pending = resume; resume = null; if (pending) await pending(); };
  const cleanup = () => { void unlock().finally(() => process.exit(0)); };
  process.once("SIGTERM", cleanup);
  try {
    resume = await requestCollectorYield();
    release = await acquireSyncLock(true);
    if (!release) throw new Error("Another TokenFlow sync is running. Try again shortly.");
    const config = await readConfig();
    if (action === "scan" || action === "sync") {
      const home = process.env.TOKENFLOW_SCAN_HOME;
      phase("scan");
      const persist = (collection: Awaited<ReturnType<typeof collectLocalUsage>>, buckets?: ReturnType<typeof aggregateEvents>) => publishLocalCache(collection, config, buckets);
      const sync = action === "sync" ? await syncLocalUsageWithHeldLock({ home, onPhase: phase, onProgress: progress, onCollected: async collection => { await persist(collection); phase("pricing"); } }) : null;
      const collection = sync?.collection || await collectLocalUsage(home, progress);
      const summary = await persist(collection, sync?.buckets);
      return { summary, lastSyncAt: sync?.lastSyncAt, warning: sync?.warning };
    }
    if (action === "configure") {
      const serverUrl = params.serverUrl || config?.serverUrl || DEFAULT_SERVER_URL;
      const deviceName = params.deviceName || config?.deviceName || os.hostname();
      if (config?.deviceToken && deviceName !== config.deviceName) await renameDevice(serverUrl, config.deviceToken, deviceName);
      await writeConfig({ ...config, serverUrl, deviceName,
        ...(typeof params.paused === "boolean" ? { autoSyncPaused: params.paused } : {}),
        installedAt: config?.installedAt || new Date().toISOString() });
    } else if (action === "api-token" || action === "authorize") {
      const serverUrl = params.serverUrl || config?.serverUrl || DEFAULT_SERVER_URL;
      if (action === "api-token") await getUploadApiTokenStatus(serverUrl, params.token);
      else if (typeof params.token !== "string" || !params.token.trim()) throw new Error("Invalid device authorization");
      const changed = config?.serverUrl !== serverUrl || (config?.apiToken || config?.deviceToken) !== params.token;
      if (changed) await fs.rm(path.join(tokenUsageDir(), "sync-state.json"), { force: true });
      await writeConfig({ ...config, serverUrl, deviceName: params.deviceName || config?.deviceName || os.hostname(),
        apiToken: action === "api-token" ? params.token : undefined, deviceToken: action === "authorize" ? params.token : undefined,
        deviceId: action === "authorize" ? params.deviceId : undefined, lastSyncAt: changed ? undefined : config?.lastSyncAt,
        installedAt: config?.installedAt || new Date().toISOString() });
    } else if (action === "logout") {
      if (config) { const { deviceToken, apiToken, deviceId, lastSyncAt, ...rest } = config; await writeConfig(rest); }
      await fs.rm(path.join(tokenUsageDir(), "sync-state.json"), { force: true });
    } else throw new Error("Unknown CLI service action");
    return {};
  } finally {
    process.removeListener("SIGTERM", cleanup);
    await unlock();
  }
}

export async function runDesktopService(): Promise<void> {
  const send = (data: unknown) => process.stdout.write(`${JSON.stringify(data)}\n`);
  const responses = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  let requestCounter = 0;
  let started = false;
  const lines = createInterface({ input: process.stdin });
  lines.on("line", (line) => {
    let request: any;
    try { request = JSON.parse(line); } catch { send({ error: "Invalid CLI request" }); return; }
    if (request.type === "cancel") {
      // Cooperative shutdown works on Windows too, where OS SIGTERM is forceful.
      if (!process.emit("SIGTERM")) process.exit(0);
      return;
    }
    if (request.type === "http-response") {
      const pending = responses.get(request.requestId); responses.delete(request.requestId);
      if (pending) request.error ? pending.reject(new Error(request.error)) : pending.resolve(request);
      return;
    }
    if (started) return;
    started = true;
    if (request.proxyHttp) setHttpClient(async (input, init) => {
      const requestId = ++requestCounter;
      const response = await new Promise<any>((resolve, reject) => {
        responses.set(requestId, { resolve, reject });
        send({ type: "http", requestId, url: String(input), method: init?.method, headers: init?.headers, body: init?.body });
        const abort = () => { responses.delete(requestId); send({ type: "http-abort", requestId }); reject(new Error("Request aborted")); };
        if (init?.signal?.aborted) abort(); else init?.signal?.addEventListener("abort", abort, { once: true });
      });
      return new Response(response.body || null, { status: response.status, headers: response.headers });
    });
    void (async () => {
      if (["scan", "sync"].includes(request.action)) await initializeSqliteReader();
      return desktopAction(request.action, request.params, (phase) => send({ type: "phase", phase }), (progress) => send({ type: "progress", progress }));
    })()
      .then((result) => send({ type: "result", result }))
      .catch((error) => { send({ type: "result", error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; })
      .finally(() => { lines.close(); process.stdin.destroy(); });
  });
}
