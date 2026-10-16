import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { tokenUsageDir } from "./config.js";

interface SyncCommandOptions {
  argvPath?: string;
  env?: Record<string, string | undefined>;
  continuous?: boolean;
}

export async function installAutoSync(serverUrl: string, home = os.homedir(), options: SyncCommandOptions = {}): Promise<string> {
  const syncCommand = buildSyncCommand(serverUrl, { ...options, continuous: true });
  if (process.platform === "darwin") return installLaunchAgent(syncCommand, home);
  if (process.platform === "linux") return installSystemdCollector(syncCommand, home);
  return "automatic sync is not installed on this platform; run tokenflow sync manually or add it to your scheduler";
}

async function installLaunchAgent(syncCommand: string, home: string): Promise<string> {
  const dir = tokenUsageDir(home);
  const binDir = path.join(dir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "sync.sh");
  const version = JSON.parse(await fs.readFile(new URL("../package.json", import.meta.url), "utf8")).version;
  const script = `#!/bin/sh\n# TokenFlow CLI ${version}\n${syncCommand}\n`;
  const oldScript = await fs.readFile(scriptPath, "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
  await fs.writeFile(scriptPath, script, { mode: 0o755 });

  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  await fs.mkdir(launchAgentsDir, { recursive: true });
  const plistPath = path.join(launchAgentsDir, "dev.tokenflow.sync.plist");
  const legacyPlistPath = path.join(launchAgentsDir, "dev.tokenusage.sync.plist");
  await fs.writeFile(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.tokenflow.sync</string>
  <key>ProgramArguments</key>
  <array><string>${escapeXml(scriptPath)}</string></array>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(path.join(dir, "sync.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(dir, "sync.err.log"))}</string>
</dict>
</plist>
`,
  );

  spawnSync("launchctl", ["unload", legacyPlistPath], { stdio: "ignore" });
  await fs.rm(legacyPlistPath, { force: true });
  if (oldScript === script && spawnSync("launchctl", ["list", "dev.tokenflow.sync"], { stdio: "ignore" }).status === 0) return `launchd collector running: ${plistPath}`;
  spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  execFileSync("launchctl", ["load", plistPath], { stdio: "ignore" });
  return `launchd agent installed: ${plistPath}`;
}

async function installSystemdCollector(syncCommand: string, home: string): Promise<string> {
  const configDir = path.join(home, ".config", "systemd", "user");
  await fs.mkdir(configDir, { recursive: true });
  const servicePath = path.join(configDir, "tokenflow-sync.service");
  const timerPath = path.join(configDir, "tokenflow-sync.timer");
  const legacyServicePath = path.join(configDir, "tokenusage-sync.service");
  const legacyTimerPath = path.join(configDir, "tokenusage-sync.timer");
  await fs.writeFile(
    servicePath,
    `[Unit]
Description=TokenFlow sync

[Service]
Type=simple
ExecStart=/bin/sh -lc ${shellQuote(syncCommand)}
Restart=always
RestartSec=15

[Install]
WantedBy=default.target
`,
  );
  spawnSync("systemctl", ["--user", "disable", "--now", "tokenusage-sync.timer"], { stdio: "ignore" });
  await fs.rm(legacyServicePath, { force: true });
  await fs.rm(legacyTimerPath, { force: true });
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  spawnSync("systemctl", ["--user", "disable", "--now", "tokenflow-sync.timer"], { stdio: "ignore" });
  await fs.rm(timerPath, { force: true });
  execFileSync("systemctl", ["--user", "enable", "--now", "tokenflow-sync.service"], {
    stdio: "inherit",
  });
  return `systemd background collector installed: ${servicePath}`;
}

export function buildSyncCommand(
  serverUrl: string,
  options: SyncCommandOptions = {},
): string {
  const env = options.env || process.env;
  const override = env.TOKENFLOW_AUTO_SYNC_COMMAND?.trim() || env.TOKENUSAGE_AUTO_SYNC_COMMAND?.trim();
  const selected = options.continuous ? override?.replace(/sync --auto$/, "collect --watch") : override;
  const command = selected || (options.continuous ? "tokenflow collect --watch" : "tokenflow sync --auto");
  return [
    `PATH=${shellQuote(schedulerPath(env))}`,
    `TOKENFLOW_SERVER_URL=${shellQuote(serverUrl)}`,
    `TOKENUSAGE_SERVER_URL=${shellQuote(serverUrl)}`,
    command,
  ].join(" ");
}

function schedulerPath(env: Record<string, string | undefined>): string {
  const entries = [
    ...(env.PATH?.trim() ? env.PATH.split(":") : []),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ];
  const seen = new Set<string>();
  return entries
    .map((entry) => entry.trim())
    .filter((entry) => {
      if (!entry || seen.has(entry)) return false;
      seen.add(entry);
      return true;
    })
    .join(":");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
