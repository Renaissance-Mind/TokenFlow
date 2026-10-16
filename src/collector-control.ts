import fs from "node:fs/promises";
import path from "node:path";
import { tokenUsageDir } from "./config.js";

export const yieldPrefix = "background-yield-";
export async function requestCollectorYield(): Promise<() => Promise<void>> {
  const root = tokenUsageDir();
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${yieldPrefix}${process.pid}.json`), tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), { mode: 0o600 });
  await fs.rename(tmp, file);
  return () => fs.rm(file, { force: true });
}
export async function collectorShouldYield(): Promise<boolean> {
  let pending = false;
  for (const name of await fs.readdir(tokenUsageDir())) {
    if (!name.startsWith(yieldPrefix) || !name.endsWith(".json")) continue;
    const file = path.join(tokenUsageDir(), name);
    const text = await fs.readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
    if (!text) continue;
    const entry = JSON.parse(text) as { pid: number; createdAt: number };
    let alive = Date.now() - entry.createdAt < 300_000;
    if (alive) try { process.kill(entry.pid, 0); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      alive = false;
    }
    if (alive) pending = true;
    else await fs.rm(file, { force: true });
  }
  return pending;
}
