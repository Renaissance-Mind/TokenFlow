import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { tokenUsageDir } from "./config.js";

export async function installAutoSync(serverUrl: string, home = os.homedir()): Promise<string> {
  if (process.platform === "darwin") return installLaunchAgent(serverUrl, home);
  if (process.platform === "linux") return installSystemdUserTimer(serverUrl, home);
  return "automatic sync is not installed on this platform; run tokenusage sync manually or add it to your scheduler";
}

async function installLaunchAgent(serverUrl: string, home: string): Promise<string> {
  const dir = tokenUsageDir(home);
  const binDir = path.join(dir, "bin");
  await fs.mkdir(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "sync.sh");
  await fs.writeFile(
    scriptPath,
    `#!/bin/sh\nTOKENUSAGE_SERVER_URL=${shellQuote(serverUrl)} npx --yes tokenusage@latest sync --auto\n`,
    { mode: 0o755 },
  );

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

async function installSystemdUserTimer(serverUrl: string, home: string): Promise<string> {
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
Environment=TOKENUSAGE_SERVER_URL=${serverUrl}
ExecStart=npx --yes tokenusage@latest sync --auto
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
