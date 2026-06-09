#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import os from "node:os";

import { ingestUsage, pollDeviceFlow, startDeviceFlow, syncPing } from "./api.js";
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
    deviceName: existing?.deviceName || os.hostname(),
    installedAt: existing?.installedAt || new Date().toISOString(),
    lastSyncAt: existing?.lastSyncAt,
  };
  await writeConfig(next);
  const schedulerStatus = options["no-auto-sync"] ? "automatic sync skipped" : await installAutoSync(serverUrl);
  process.stdout.write(`TokenUsage configured at ${configPath()}\n`);
  process.stdout.write(`${schedulerStatus}\n`);
  if (!next.deviceToken && !options["no-login"]) {
    await cmdLogin(["--server-url", serverUrl]);
  }
}

async function cmdLogin(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  const existing = await readConfig();
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || existing?.serverUrl);
  const deviceName = optionString(options, "device-name") || existing?.deviceName || os.hostname();
  const flow = await startDeviceFlow({
    serverUrl,
    deviceName,
    platform: process.platform,
  });

  process.stdout.write(`Open this URL and sign in with GitHub or Google:\n${flow.verificationUrl}\n`);
  process.stdout.write(`Code: ${flow.userCode}\n`);
  if (!options["no-open"]) openBrowser(flow.verificationUrl);

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
  if (!config?.deviceToken) throw new Error("Not logged in. Run tokenusage login first.");
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || config.serverUrl);
  const collection = await collectLocalUsage();
  const buckets = aggregateEvents(collection.events);
  const result = buckets.length > 0 ? await ingestUsage({ serverUrl, deviceToken: config.deviceToken, buckets }) : { inserted: 0, updated: 0 };
  await syncPing(serverUrl, config.deviceToken);
  await writeConfig({ ...config, serverUrl, lastSyncAt: new Date().toISOString() });
  if (!options.auto) {
    process.stdout.write(`Parsed events: ${collection.events.length}\n`);
    process.stdout.write(`Uploaded buckets: ${buckets.length} (${result.inserted} inserted, ${result.updated} updated)\n`);
  }
}

async function cmdStatus(): Promise<void> {
  const config = await readConfig();
  const collection = await collectLocalUsage();
  const buckets = aggregateEvents(collection.events);
  process.stdout.write(
    [
      "TokenUsage status",
      `Config: ${config ? configPath() : "missing"}`,
      `Server: ${config?.serverUrl || process.env.TOKENUSAGE_SERVER_URL || DEFAULT_SERVER_URL}`,
      `Device: ${config?.deviceId || "not linked"}`,
      `Token: ${config?.deviceToken ? "set" : "missing"}`,
      `Last sync: ${config?.lastSyncAt || "never"}`,
      `Local events: ${collection.events.length}`,
      `Local buckets: ${buckets.length}`,
      ...collection.sources.map(
        (source) => `Source ${source.agent}: ${source.exists ? "found" : "missing"} (${source.files} files) ${source.path}`,
      ),
      `Home: ${tokenUsageDir()}`,
      "",
    ].join("\n"),
  );
}

async function cmdUpdate(argv: string[]): Promise<void> {
  const options = parseOptions(argv);
  execFileSync("npm", ["install", "-g", "tokenusage@latest"], { stdio: "inherit" });
  const config = await readConfig();
  const serverUrl = normalizeServerUrl(optionString(options, "server-url") || config?.serverUrl);
  const schedulerStatus = await installAutoSync(serverUrl);
  process.stdout.write(`TokenUsage updated.\n${schedulerStatus}\n`);
}

async function cmdLogout(): Promise<void> {
  const config = await readConfig();
  if (!config) {
    process.stdout.write("No TokenUsage config found.\n");
    return;
  }
  const { deviceToken: _deviceToken, deviceId: _deviceId, ...rest } = config;
  await writeConfig(rest);
  process.stdout.write("Local device token removed.\n");
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

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  execFileSync(command, args, { stdio: "ignore" });
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
      "  tokenusage sync",
      "  tokenusage status",
      "  tokenusage update",
      "  tokenusage logout",
      "",
      "Supported local agents: Codex, Claude Code, Gemini CLI.",
      "Default server URL for local development: http://127.0.0.1:8787",
      "",
    ].join("\n"),
  );
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
