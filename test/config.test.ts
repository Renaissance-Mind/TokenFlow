import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SERVER_URL, normalizeServerUrl, tokenUsageDir } from "../src/config.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("server URL configuration", () => {
  it("uses the hosted production server by default", () => {
    expect(DEFAULT_SERVER_URL).toBe("https://tokenflow.renaissancemind.ai");
    expect(normalizeServerUrl(undefined)).toBe("https://tokenflow.renaissancemind.ai");
  });

  it("keeps explicit local development server URLs available", () => {
    expect(normalizeServerUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
  });

  it("keeps the old TokenUsage server URL environment variable as a fallback", () => {
    process.env.TOKENUSAGE_SERVER_URL = "https://legacy.example.com/";
    expect(normalizeServerUrl(undefined)).toBe("https://legacy.example.com");
  });

  it("continues using an existing .tokenusage config directory for old installs", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-config-"));
    await fs.mkdir(path.join(home, ".tokenusage"));
    await fs.writeFile(path.join(home, ".tokenusage", "config.json"), "{}\n");
    expect(tokenUsageDir(home)).toBe(path.join(home, ".tokenusage"));
  });
});
