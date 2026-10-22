import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { inspectCli } from "./cli-installation.js";

const execute = promisify(execFile);
export const cliRegistry = "https://registry.npmjs.org";
export function compareVersions(a: string, b: string): number {
  if (![a, b].every(value => /^\d+\.\d+\.\d+$/.test(value))) throw new Error("Invalid CLI version");
  const left = a.split(".").map(Number), right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return Math.sign(left[i] - right[i]);
  return 0;
}

// npm verifies registry integrity and resolves runtime dependencies. A nested
// install keeps the package self-contained when it replaces an existing CLI.
// Never execute registry lifecycle scripts or inherit a machine's npm mirror.
export async function withLatestCli<T>(node: string, npm: string, consume: (payload: string, version: string) => Promise<T>): Promise<T> {
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-cli-update-"));
  try {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^npm_config_/i.test(key) || key === "ELECTRON_RUN_AS_NODE" || key === "NODE_ENV") delete env[key];
    const config = path.join(staging, "npmrc"); await fs.writeFile(config, "");
    await execute(node, [npm, "install", "--prefix", staging, "--registry", cliRegistry,
      "--userconfig", config, "--globalconfig", config + ".global", "--ignore-scripts", "--omit=dev",
      "--install-strategy=nested", "--no-audit", "--no-fund", "--package-lock=false", "--fetch-retries=2",
      "--fetch-timeout=60000", "@renaissancemind/tokenflow@latest"],
    { env, cwd: staging, timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
    const payload = path.join(staging, "node_modules", "@renaissancemind", "tokenflow");
    const installation = await inspectCli(path.join(payload, "dist", "cli.js"), node, "managed");
    if (!installation?.compatible) throw new Error("The latest CLI requires a newer TokenFlow App. Update App first.");
    compareVersions(installation.version, installation.version);
    const result = await execute(node, [installation.entrypoint, "--version"], { env, timeout: 30_000, windowsHide: true });
    if (result.stdout.trim() !== installation.version) throw new Error("The downloaded CLI failed its version check");
    return await consume(payload, installation.version);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
}
