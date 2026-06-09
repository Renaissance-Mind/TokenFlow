import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { tokenUsageDir } from "./config.js";

interface SyncCommandOptions {
  argvPath?: string;
  env?: Record<string, string | undefined>;
}

export async function installAutoSync(serverUrl: string, home = os.homedir()): Promise<string> {
  const syncCommand = buildSyncCommand(serverUrl);
  if (process.platform === "darwin") return installLaunchAgent(syncCommand, home);
  if (process.platform === "linux") return installSystemdUserTimer(syncCommand, home);
  return "automatic sync is not installed on this platform; run tokenusage sync manually or add it to your scheduler";
}

async function installLaunchAgent(syncCommand: string, home: string): Promise<string> {
  const dir = tokenUsageDir(home);
  const binDir = path.join(dir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "sync.sh");
  await fs.writeFile(scriptPath, `#!/bin/sh\n${syncCommand}\n`, { mode: 0o755 });

  const launchAgentsDir = path.join(home, "Library", "LaunchAgents");
  await fs.mkdir(launchAgentsDir, { recursive: true });
  const plistPath = path.join(launchAgentsDir, "dev.tokenusage.sync.plist");
  await fs.writeFile(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.tokenusage.sync</string>
  <key>ProgramArguments</key>
  <array><string>${escapeXml(scriptPath)}</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>${escapeXml(path.join(dir, "sync.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(path.join(dir, "sync.err.log"))}</string>
</dict>
</plist>
`,
  );

  spawnSync("launchctl", ["unload", plistPath], { stdio: "ignore" });
  execFileSync("launchctl", ["load", plistPath], { stdio: "ignore" });
  return `launchd agent installed: ${plistPath}`;
}

async function installSystemdUserTimer(syncCommand: string, home: string): Promise<string> {
  const configDir = path.join(home, ".config", "systemd", "user");
  await fs.mkdir(configDir, { recursive: true });
  const servicePath = path.join(configDir, "tokenusage-sync.service");
  const timerPath = path.join(configDir, "tokenusage-sync.timer");
  await fs.writeFile(
    servicePath,
    `[Unit]
Description=TokenUsage sync

[Service]
Type=oneshot
ExecStart=/bin/sh -lc ${shellQuote(syncCommand)}
`,
  );
  await fs.writeFile(
    timerPath,
    `[Unit]
Description=Run TokenUsage sync every 10 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true

[Install]
WantedBy=timers.target
`,
  );
  execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["--user", "enable", "--now", "tokenusage-sync.timer"], {
    stdio: "inherit",
  });
  return `systemd user timer installed: ${timerPath}`;
}

export function buildSyncCommand(
  serverUrl: string,
  options: SyncCommandOptions = {},
): string {
  const env = options.env || process.env;
  const override = env.TOKENUSAGE_AUTO_SYNC_COMMAND?.trim();
  const command = override || "npx --yes @renaissancemind/tokenusage@latest sync --auto";
  return `PATH=${shellQuote(schedulerPath(env))} TOKENUSAGE_SERVER_URL=${shellQuote(serverUrl)} ${command}`;
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
