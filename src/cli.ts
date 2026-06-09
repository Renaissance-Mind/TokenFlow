#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import os from "node:os";

import { getDeviceStatus, ingestUsage, pollDeviceFlow, startDeviceFlow, syncPing } from "./api.js";
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
import { formatStatus } from "./status.js";
import { resolveUpdatePackageSpec } from "./update.js";
import { aggregateEvents } from "./usage-buckets.js";

type Command = "init" | "login" | "sync" | "status" | "update" | "logout" | "help";

async function main(argv: string[]): Promise<void> {
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
  const next = {
    serverUrl,
    deviceToken: existing?.deviceToken,
    deviceId: existing?.deviceId,
    apiToken: optionString(options, "api-token") || existing?.apiToken,
    deviceName: existing?.deviceName || os.hostname(),
    installedAt: existing?.installedAt || new Date().toISOString(),
    lastSyncAt: existing?.lastSyncAt,
  };
  await writeConfig(next);
  const schedulerStatus = options["no-auto-sync"] ? "automatic sync skipped" : await installAutoSync(serverUrl);
  process.stdout.write(`TokenUsage configured at ${configPath()}\n`);
  process.stdout.write(`${schedulerStatus}\n`);
  if (!next.deviceToken && !next.apiToken && !options["no-login"]) {
    await cmdLogin(["--server-url", serverUrl]);
  }
}

async function cmdLogin(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const existing = await readConfig();
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || existing?.serverUrl);
  const deviceName = optionString(options, "device-name") || existing?.deviceName || os.hostname();
  const apiToken = optionString(options, "api-token");
  if (apiToken) {
    await writeConfig({
      ...(existing || { installedAt: new Date().toISOString() }),
      serverUrl,
      deviceName,
      apiToken,
    });
    process.stdout.write("Read-write API token configured for uploads.\n");
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
      return;
    }
  }
  throw new Error("Login timed out before the device was approved");
}

async function cmdSync(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const config = await readConfig();
  const uploadToken = config?.apiToken || config?.deviceToken;
  if (!config || !uploadToken) throw new Error("Not logged in. Run tokenusage login first.");
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || config.serverUrl);
  const deviceName = config.deviceName || os.hostname();
  const collection = await collectLocalUsage();
  const buckets = aggregateEvents(collection.events, collection.pricingProfiles);
  const result = buckets.length > 0
    ? await ingestUsage({
        serverUrl,
        uploadToken,
        deviceName,
        platform: process.platform,
        buckets,
      })
    : { inserted: 0, updated: 0 };
  await syncPing(serverUrl, uploadToken, { deviceName, platform: process.platform });
  await writeConfig({ ...config, serverUrl, lastSyncAt: new Date().toISOString() });
  if (!options.auto) {
    process.stdout.write(`Parsed events: ${collection.events.length}\n`);
    process.stdout.write(`Uploaded buckets: ${buckets.length} (${result.inserted} inserted, ${result.updated} updated)\n`);
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
  const remoteReport = config?.deviceToken
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
  process.stdout.write(`TokenUsage updated from ${packageSpec}.\n${schedulerStatus}\n`);
}

async function cmdLogout(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    process.stdout.write("No TokenUsage config found.\n");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printHelp(): void {
  process.stdout.write(
    [
      "TokenUsage",
      "",
      "Usage:",
      "  tokenusage init --server-url https://usage.example.com",
      "  tokenusage login --server-url https://usage.example.com",
      "  tokenusage login --server-url https://usage.example.com --api-token tu_api_...",
      "  tokenusage sync",
      "  tokenusage status",
      "  tokenusage update [--source tokenusage@latest|/path/to/TokenUsage]",
      "  tokenusage logout",
      "",
      "Supported local agents: Codex, Claude Code, Gemini CLI, OpenCode.",
      "Default server URL for local development: http://127.0.0.1:8787",
      "",
    ].join("\n"),
  );
}

function countUnpricedBuckets(buckets: Array<{ pricingStatus?: string }>): number {
  return buckets.filter((bucket) => bucket.pricingStatus === "unpriced").length;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
