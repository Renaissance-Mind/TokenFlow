import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { acquireSyncLock, desktopAgentIsRunning } from "../src/collector.js";

describe("collector coordination", () => {
  it("serializes CLI/desktop syncs and recognizes a live desktop owner", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-lock-"));
    const previous = process.env.TOKENFLOW_HOME;
    process.env.TOKENFLOW_HOME = root;
    try {
      const release = await acquireSyncLock();
      expect(release).not.toBeNull();
      expect(await acquireSyncLock()).toBeNull();
      await release!();
      const next = await acquireSyncLock();
      expect(next).not.toBeNull(); await next!();
      expect(await desktopAgentIsRunning()).toBe(false);
      await fs.writeFile(path.join(root, "desktop-agent.json"), JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }));
      expect(await desktopAgentIsRunning()).toBe(true);
      await fs.writeFile(path.join(root, "desktop-agent.json"), JSON.stringify({ pid: process.pid, updatedAt: new Date(Date.now() - 180_000).toISOString() }));
      expect(await desktopAgentIsRunning()).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TOKENFLOW_HOME; else process.env.TOKENFLOW_HOME = previous;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
