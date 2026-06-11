#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

import {
  getApiTokenStatus,
  getDeviceStatus,
  getUploadApiTokenStatus,
  ingestUsageSnapshot,
  pollDeviceFlow,
  startDeviceFlow,
  syncPing,
} from "./api.js";
import { tryOpenBrowser } from "./browser.js";
import {
  configPath,
  DEFAULT_SERVER_URL,
  normalizeServerUrl,
  readConfig,
  tokenUsageDir,
  writeConfig,
} from "./config.js";
import { collectLocalUsage } from "./file-scan.js";
import { installAutoSync } from "./scheduler.js";
import { formatStatus, type UnpricedModelStatus } from "./status.js";
import {
  markSyncPlanUploaded,
  planIncrementalSync,
  readSyncState,
  writeSyncState,
} from "./sync-state.js";
import type { UsageBucket } from "./types.js";
import { resolveUpdatePackageSpec } from "./update.js";
import { aggregateEvents } from "./usage-buckets.js";

type Command = "init" | "login" | "sync" | "status" | "update" | "logout" | "help";

export async function main(argv: string[]): Promise<void> {
  const [rawCommand = "help", ...rest] = argv;
  const command = normalizeCommand(rawCommand);

  if (command === "help") {
    printHelp();
    return;
  }
  if (command === "init") return cmdInit(rest);
  if (command === "login") return cmdLogin(rest);
  if (command === "sync") return cmdSync(rest);
  if (command === "status") return cmdStatus();
  if (command === "update") return cmdUpdate(rest);
  if (command === "logout") return cmdLogout();
}

async function cmdInit(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const serverUrl = normalizeServerUrl(optionString(options, "server-url"));
  const existing = await readConfig();
  const apiToken = optionString(options, "api-token");
  if (apiToken) await getUploadApiTokenStatus(serverUrl, apiToken);
  const next = {
    serverUrl,
    deviceToken: existing?.deviceToken,
    deviceId: existing?.deviceId,
    apiToken: apiToken || existing?.apiToken,
    deviceName: existing?.deviceName || os.hostname(),
    installedAt: existing?.installedAt || new Date().toISOString(),
    lastSyncAt: existing?.lastSyncAt,
  };
  await writeConfig(next);
  const schedulerStatus = options["no-auto-sync"] ? "automatic sync skipped" : await installAutoSync(serverUrl);
  process.stdout.write(`TokenFlow configured at ${configPath()}\n`);
  process.stdout.write(`${schedulerStatus}\n`);
  if (!next.deviceToken && !next.apiToken && !options["no-login"]) {
    await cmdLogin(["--server-url", serverUrl, ...(options["no-sync"] ? ["--no-sync"] : [])]);
  }
}

async function cmdLogin(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const existing = await readConfig();
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || existing?.serverUrl);
  const deviceName = optionString(options, "device-name") || existing?.deviceName || os.hostname();
  const apiToken = optionString(options, "api-token");
  if (apiToken) {
    await getUploadApiTokenStatus(serverUrl, apiToken);
    await writeConfig({
      ...(existing || { installedAt: new Date().toISOString() }),
      serverUrl,
      deviceName,
      apiToken,
    });
    process.stdout.write("Read-write API token configured for uploads.\n");
    if (!options["no-sync"]) await runInitialSync(serverUrl);
    return;
  }
  const flow = await startDeviceFlow({
    serverUrl,
    deviceName,
    platform: process.platform,
  });

  process.stdout.write(`Open this URL and sign in with GitHub or Google:\n${flow.verificationUrl}\n`);
  process.stdout.write(`Code: ${flow.userCode}\n`);
  if (!options["no-open"] && !tryOpenBrowser(flow.verificationUrl)) {
    process.stdout.write("Could not open a browser automatically; open the URL above manually.\n");
  }

  const expiresAt = new Date(flow.expiresAt).getTime();
  while (Date.now() < expiresAt) {
    await sleep(flow.pollIntervalSeconds * 1000);
    const status = await pollDeviceFlow(serverUrl, flow.deviceCode);
    if (status.status === "approved") {
      if (!status.token || !status.deviceId) throw new Error("Device approved without token");
      await writeConfig({
        ...(existing || { installedAt: new Date().toISOString() }),
        serverUrl,
        deviceName,
        deviceToken: status.token,
        deviceId: status.deviceId,
      });
      process.stdout.write(`Device linked: ${status.deviceId}\n`);
      if (!options["no-sync"]) await runInitialSync(serverUrl);
      return;
    }
  }
  throw new Error("Login timed out before the device was approved");
}

async function runInitialSync(serverUrl: string): Promise<void> {
  process.stdout.write("Running initial sync...\n");
  await cmdSync(["--server-url", serverUrl]);
}

async function cmdSync(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const config = await readConfig();
  const uploadToken = config?.apiToken || config?.deviceToken;
  if (!config || !uploadToken) throw new Error("Not logged in. Run tokenflow login first.");
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || config.serverUrl);
  const deviceName = config.deviceName || os.hostname();
  const collection = await collectLocalUsage();
  const buckets = aggregateEvents(collection.events, collection.pricingProfiles);
  const syncState = await readSyncState();
  const plan = planIncrementalSync(buckets, syncState, { maxBuckets: Number.MAX_SAFE_INTEGER });
  const shouldIngest = plan.buckets.length > 0;
  const result = shouldIngest
    ? await ingestUsageSnapshot({
        serverUrl,
        uploadToken,
        deviceName,
        platform: process.platform,
        buckets,
      })
    : { accepted: 0, updated: 0 };
  if (shouldIngest) {
    await writeSyncState(
      markSyncPlanUploaded(syncState, { buckets, replaceDailyBuckets: [], replaceUnknownBuckets: [] }, new Date().toISOString()),
    );
  }
  await syncPing(serverUrl, uploadToken, { deviceName, platform: process.platform });
  await writeConfig({ ...config, serverUrl, lastSyncAt: new Date().toISOString() });
  if (!options.auto) {
    process.stdout.write(`Parsed events: ${collection.events.length}\n`);
    process.stdout.write(`Uploaded snapshot: ${result.accepted} of ${buckets.length} local buckets (${result.updated} daily records)\n`);
    const unpricedBuckets = countUnpricedBuckets(buckets);
    if (unpricedBuckets > 0) {
      process.stdout.write(`Unpriced buckets: ${unpricedBuckets} (cost for these buckets is recorded as $0.000000)\n`);
    }
  }
}

async function cmdStatus(): Promise<void> {
  const config = await readConfig();
  const collection = await collectLocalUsage();
  const buckets = aggregateEvents(collection.events, collection.pricingProfiles);
  const serverUrl = normalizeServerUrl(config?.serverUrl);
  const remoteReport = config?.apiToken
    ? await getRemoteApiTokenStatusForReport(serverUrl, config.apiToken)
    : config?.deviceToken
      ? await getRemoteStatusForReport(serverUrl, config.deviceToken)
      : {};
  process.stdout.write(
    formatStatus({
      configPath: config ? configPath() : "missing",
      serverUrl,
      deviceId: config?.deviceId,
      hasDeviceToken: Boolean(config?.deviceToken),
      hasApiToken: Boolean(config?.apiToken),
      lastSyncAt: config?.lastSyncAt,
      localEvents: collection.events.length,
      localBuckets: buckets.length,
      unpricedBuckets: countUnpricedBuckets(buckets),
      unpricedModels: summarizeUnpricedModels(buckets),
      sources: collection.sources,
      home: tokenUsageDir(),
      ...remoteReport,
    }),
  );
}

async function cmdUpdate(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const packageSpec = resolveUpdatePackageSpec(optionString(options, "source"));
  execFileSync("npm", ["install", "-g", packageSpec], { stdio: "inherit" });
  const config = await readConfig();
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || config?.serverUrl);
  const schedulerStatus = await installAutoSync(serverUrl);
  process.stdout.write(`TokenFlow updated from ${packageSpec}.\n${schedulerStatus}\n`);
}

async function cmdLogout(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    process.stdout.write("No TokenFlow config found.\n");
    return;
  }
  const { deviceToken: _deviceToken, deviceId: _deviceId, apiToken: _apiToken, ...rest } = config;
  await writeConfig(rest);
  process.stdout.write("Local upload tokens removed.\n");
}

function normalizeCommand(command: string): Command {
  if (["init", "login", "sync", "status", "update", "logout"].includes(command)) {
    return command as Command;
  }
  return "help";
}

function parseOptions(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function optionString(options: Record<string, string | boolean>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" ? value : undefined;
}

async function getRemoteStatusForReport(
  serverUrl: string,
  deviceToken: string,
): Promise<
  | { remote: Awaited<ReturnType<typeof getDeviceStatus>>; remoteError?: undefined }
  | { remote?: undefined; remoteError: string }
> {
  try {
    return { remote: await getDeviceStatus(serverUrl, deviceToken) };
  } catch (error) {
    return { remoteError: error instanceof Error ? error.message : String(error) };
  }
}

async function getRemoteApiTokenStatusForReport(
  serverUrl: string,
  apiToken: string,
): Promise<
  | { remoteApiToken: Awaited<ReturnType<typeof getApiTokenStatus>>; remoteError?: undefined }
  | { remoteApiToken?: undefined; remoteError: string }
> {
  try {
    return { remoteApiToken: await getApiTokenStatus(serverUrl, apiToken) };
  } catch (error) {
    return { remoteError: error instanceof Error ? error.message : String(error) };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  process.stdout.write(
    [
      "TokenFlow",
      "",
      "Usage:",
      "  tokenflow init --server-url https://tokenflow.renaissancemind.ai",
      "  tokenflow login --server-url https://tokenflow.renaissancemind.ai",
      "  tokenflow login --no-sync",
      "  tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...",
      "  tokenflow sync",
      "  tokenflow status",
      "  tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]",
      "  tokenflow logout",
      "",
      "Compatibility: the old tokenusage command still works.",
      "Supported local agents: Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, and Qwen Code.",
      "Default server URL: https://tokenflow.renaissancemind.ai",
      "For local development, pass --server-url http://127.0.0.1:8787",
      "",
    ].join("\n"),
  );
}

function countUnpricedBuckets(buckets: Array<{ pricingStatus?: string }>): number {
  return buckets.filter((bucket) => bucket.pricingStatus === "unpriced").length;
}

function summarizeUnpricedModels(buckets: UsageBucket[]): UnpricedModelStatus[] {
  const models = new Map<string, UnpricedModelStatus>();
  for (const bucket of buckets) {
    if (bucket.pricingStatus !== "unpriced") continue;
    const key = `${bucket.agent}\t${bucket.model}`;
    const existing = models.get(key) || {
      agent: bucket.agent,
      model: bucket.model,
      buckets: 0,
      totalTokens: 0,
    };
    existing.buckets += 1;
    existing.totalTokens += bucket.totalTokens;
    models.set(key, existing);
  }
  return Array.from(models.values()).sort((a, b) => b.totalTokens - a.totalTokens);
}

if (isCliEntrypoint()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) return false;
  return realpathSync(entrypoint) === fileURLToPath(import.meta.url);
}
