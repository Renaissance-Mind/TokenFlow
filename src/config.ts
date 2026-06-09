import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface TokenUsageConfig {
  serverUrl: string;
  deviceToken?: string;
  deviceId?: string;
  deviceName?: string;
  installedAt?: string;
  lastSyncAt?: string;
}

export const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";

export function tokenUsageDir(home = os.homedir()): string {
  return process.env.TOKENUSAGE_HOME || path.join(home, ".tokenusage");
}

export function configPath(home = os.homedir()): string {
  return path.join(tokenUsageDir(home), "config.json");
}

export async function readConfig(home = os.homedir()): Promise<TokenUsageConfig | null> {
  const file = configPath(home);
  const raw = await fs.readFile(file, "utf8").catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return null;
  return JSON.parse(raw) as TokenUsageConfig;
}

export async function writeConfig(config: TokenUsageConfig, home = os.homedir()): Promise<void> {
  const dir = tokenUsageDir(home);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${configPath(home)}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, configPath(home));
}

export function normalizeServerUrl(value: string | undefined): string {
  const url = (value || process.env.TOKENUSAGE_SERVER_URL || DEFAULT_SERVER_URL).trim();
  return url.replace(/\/+$/, "");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === "object" && "code" in error);
}
