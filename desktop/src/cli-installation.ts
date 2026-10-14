import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export interface CliInstallation {
  source: "installed" | "managed";
  entrypoint: string;
  node: string;
  packageDir: string;
  version: string;
  compatible: boolean;
}
function compareVersions(a: string, b: string): number {
  const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (aa[i] !== bb[i]) return Math.sign((aa[i] || 0) - (bb[i] || 0));
  return 0;
}
export async function collectorHome(home = os.homedir(), env = process.env): Promise<string> {
  if (env.TOKENFLOW_HOME || env.TOKENUSAGE_HOME) return env.TOKENFLOW_HOME || env.TOKENUSAGE_HOME!;
  return await fs.stat(path.join(home, ".tokenusage", "config.json")).then(() => path.join(home, ".tokenusage")).catch(() => path.join(home, ".tokenflow"));
}
function paths(env: NodeJS.ProcessEnv, home: string): string[] {
  return [...new Set([...(env.PATH || "").split(path.delimiter), path.join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", env.APPDATA ? path.join(env.APPDATA, "npm") : ""].filter(Boolean))];
}
async function executable(name: string, dirs: string[]): Promise<string | null> {
  for (const dir of dirs) {
    const file = path.join(dir, name);
    if (await fs.access(file).then(() => true).catch(() => false)) return file;
  }
  return null;
}
export async function inspectCli(entrypoint: string, node: string, source: CliInstallation["source"]): Promise<CliInstallation | null> {
  try {
    const real = await fs.realpath(entrypoint);
    const packageDir = path.dirname(path.dirname(real));
    const pkg = JSON.parse(await fs.readFile(path.join(packageDir, "package.json"), "utf8"));
    if (!["@renaissancemind/tokenflow", "@renaissancemind/tokenusage"].includes(pkg.name)) return null;
    return { source, entrypoint: real, node, packageDir, version: pkg.version,
      compatible: pkg.tokenflow?.desktopProtocol === 2 && await fs.access(path.join(packageDir, "dist", "desktop-service.js")).then(() => true).catch(() => false) };
  } catch { return null; }
}
export async function findCli(options: { home?: string; env?: NodeJS.ProcessEnv; fallbackNode?: string } = {}): Promise<CliInstallation | null> {
  const home = options.home || os.homedir(); const env = options.env || process.env;
  const dirs = paths(env, home);
  const node = await executable(process.platform === "win32" ? "node.exe" : "node", dirs) || options.fallbackNode;
  if (env.TOKENFLOW_CLI_PATH) {
    if (!node) throw new Error("A Node.js runtime is required for the selected CLI");
    const selected = await inspectCli(env.TOKENFLOW_CLI_PATH, node, "installed");
    if (!selected) throw new Error("TOKENFLOW_CLI_PATH must point to a TokenFlow dist/cli.js");
    return selected;
  }
  const data = await collectorHome(home, env);
  const selected = await fs.readFile(path.join(data, "cli-installation.json"), "utf8").catch(() => null);
  let managed: CliInstallation | null = null;
  if (selected) {
    const saved = JSON.parse(selected) as CliInstallation;
    managed = await inspectCli(saved.entrypoint, saved.node, saved.source);
    if (managed && !await fs.access(managed.node).then(() => true).catch(() => false)) managed = null;
  }
  // Tests with an isolated config must never attach to a user's global install.
  if (!env.TOKENFLOW_DESKTOP_DATA && node) {
    let outdated: CliInstallation | null = null;
    for (const dir of dirs) for (const name of ["tokenflow", "tokenusage"]) {
      const entry = process.platform === "win32" ? path.join(dir, "node_modules", "@renaissancemind", name, "dist", "cli.js") : path.join(dir, name);
      const candidate = await inspectCli(entry, node, "installed");
      if (candidate?.compatible && candidate.entrypoint !== managed?.entrypoint && (!managed || compareVersions(candidate.version, managed.version) >= 0)) return candidate;
      if (candidate && !outdated) outdated = candidate;
    }
    if (outdated && !managed?.compatible) return outdated;
  }
  return managed;
}
export async function rememberCli(installation: CliInstallation, home = os.homedir(), env = process.env): Promise<void> {
  const data = await collectorHome(home, env); await fs.mkdir(data, { recursive: true });
  const metadata = path.join(data, "cli-installation.json");
  await fs.writeFile(`${metadata}.${process.pid}.tmp`, JSON.stringify(installation), { mode: 0o600 });
  await fs.rename(`${metadata}.${process.pid}.tmp`, metadata);
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export async function installCli(payload: string, runtime: string, options: { home?: string; env?: NodeJS.ProcessEnv; replace?: CliInstallation; copyRuntime?: boolean } = {}): Promise<CliInstallation> {
  const home = options.home || os.homedir(); const env = options.env || process.env;
  const data = await collectorHome(home, env);
  const pkg = JSON.parse(await fs.readFile(path.join(payload, "package.json"), "utf8"));
  if (options.replace && compareVersions(options.replace.version, pkg.version) > 0) throw new Error("The installed CLI is newer than the App installer. Update App instead of downgrading the CLI.");
  const dir = options.replace?.packageDir || path.join(data, "cli", pkg.version);
  const stage = `${dir}.install-${process.pid}`;
  await fs.mkdir(path.dirname(dir), { recursive: true });
  await fs.rm(stage, { recursive: true, force: true });
  await fs.cp(payload, stage, { recursive: true });
  // Persist a standalone Node runtime, so quitting/removing App does not remove CLI.
  const runtimeDir = path.join(data, "runtime"); await fs.mkdir(runtimeDir, { recursive: true });
  const node = options.copyRuntime ? path.join(runtimeDir, process.platform === "win32" ? "node.exe" : "node") : runtime;
  if (!options.replace && options.copyRuntime) {
    await fs.copyFile(runtime, `${node}.tmp`); await fs.chmod(`${node}.tmp`, 0o755); await fs.rename(`${node}.tmp`, node);
    await fs.copyFile(path.join(path.dirname(runtime), "LICENSE"), path.join(runtimeDir, "LICENSE"));
  }
  const backup = `${dir}.previous-${process.pid}`;
  await fs.rm(backup, { recursive: true, force: true });
  const exists = await fs.stat(dir).then(() => true).catch(() => false);
  if (exists) await fs.rename(dir, backup);
  try { await fs.rename(stage, dir); } catch (error) { if (exists) await fs.rename(backup, dir); throw error; }
  const result = await inspectCli(path.join(dir, "dist", "cli.js"), options.replace?.node || node, options.replace?.source || "managed");
  if (!result?.compatible) { await fs.rm(dir, { recursive: true, force: true }); if (exists) await fs.rename(backup, dir); throw new Error("CLI installation did not contain a supported service"); }
  await fs.chmod(result.entrypoint, 0o755);
  await fs.rm(backup, { recursive: true, force: true });
  await fs.mkdir(data, { recursive: true });
  await rememberCli(result, home, env);
  const bin = env.TOKENFLOW_DESKTOP_DATA ? path.join(data, "bin") : process.platform === "win32" ? path.join(env.LOCALAPPDATA || home, "TokenFlow", "bin") : path.join(home, ".local", "bin");
  await fs.mkdir(bin, { recursive: true });
  const bootstrap = path.join(data, "cli-launcher.mjs");
  await fs.writeFile(bootstrap, `import fs from 'node:fs';\nimport {spawnSync} from 'node:child_process';\nconst cli=JSON.parse(fs.readFileSync(new URL('./cli-installation.json',import.meta.url),'utf8'));\nconst result=spawnSync(cli.node,[cli.entrypoint,...process.argv.slice(2)],{stdio:'inherit',env:process.env});\nif(result.error){process.stderr.write(result.error.message+'\\n');process.exit(1);}\nprocess.exit(result.status??1);\n`, { mode: 0o600 });
  const launcher = process.platform === "win32" ? `@echo off\r\n"${result.node}" "${bootstrap}" %*\r\n` : `#!/bin/sh\nexec ${shellQuote(result.node)} ${shellQuote(bootstrap)} "$@"\n`;
  for (const name of ["tokenflow", "tokenusage"]) {
    const file = path.join(bin, process.platform === "win32" ? `${name}.cmd` : name);
    await fs.writeFile(file, launcher, { mode: 0o755 });
  }
  if (!env.TOKENFLOW_DESKTOP_DATA) {
    if (process.platform === "win32") {
      const command = `$p=[Environment]::GetEnvironmentVariable('Path','User'); $b='${bin.replaceAll("'", "''")}'; if (($p -split ';') -notcontains $b) { [Environment]::SetEnvironmentVariable('Path',($b+';'+$p),'User') }`;
      await execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command]);
    } else {
      const profile = path.join(home, path.basename(env.SHELL || "zsh") === "bash" ? ".bash_profile" : ".zprofile");
      const content = await fs.readFile(profile, "utf8").catch(() => "");
      if (!content.includes("# TokenFlow CLI")) await fs.appendFile(profile, `\n# TokenFlow CLI\nexport PATH=${shellQuote(bin)}:"$PATH"\n`);
    }
  }
  return result;
}
