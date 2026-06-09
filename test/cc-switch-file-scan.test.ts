import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { collectLocalUsage } from "../src/file-scan.js";
import { aggregateEvents } from "../src/usage-buckets.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("cc-switch file scan", () => {
  it("reads proxy usage and model pricing from the cc-switch SQLite database", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokenusage-cc-switch-"));
    await fs.mkdir(path.join(root, "codex", "sessions"), { recursive: true });
    await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
    await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
    await fs.mkdir(path.join(root, "opencode"), { recursive: true });
    const ccSwitchHome = path.join(root, ".cc-switch");
    await fs.mkdir(ccSwitchHome, { recursive: true });
    const dbPath = path.join(ccSwitchHome, "cc-switch.db");

    execFileSync("sqlite3", [
      dbPath,
      `
      CREATE TABLE model_pricing (
        model_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        input_cost_per_million TEXT NOT NULL,
        output_cost_per_million TEXT NOT NULL,
        cache_read_cost_per_million TEXT NOT NULL DEFAULT '0',
        cache_creation_cost_per_million TEXT NOT NULL DEFAULT '0'
      );
      CREATE TABLE proxy_request_logs (
        request_id TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        app_type TEXT NOT NULL,
        model TEXT NOT NULL,
        request_model TEXT,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        input_cost_usd TEXT NOT NULL DEFAULT '0',
        output_cost_usd TEXT NOT NULL DEFAULT '0',
        cache_read_cost_usd TEXT NOT NULL DEFAULT '0',
        cache_creation_cost_usd TEXT NOT NULL DEFAULT '0',
        total_cost_usd TEXT NOT NULL DEFAULT '0',
        latency_ms INTEGER NOT NULL,
        first_token_ms INTEGER,
        duration_ms INTEGER,
        status_code INTEGER NOT NULL,
        error_message TEXT,
        session_id TEXT,
        provider_type TEXT,
        is_streaming INTEGER NOT NULL DEFAULT 0,
        cost_multiplier TEXT NOT NULL DEFAULT '1.0',
        created_at INTEGER NOT NULL,
        data_source TEXT NOT NULL DEFAULT 'proxy'
      );
      INSERT INTO model_pricing VALUES ('new-model-special', 'New Model Special', '2', '8', '0.20', '0');
      INSERT INTO proxy_request_logs VALUES
        ('req_ok', 'provider_1', 'codex', 'new-model-special', 'new-model-special',
         1000, 100, 400, 0, '0', '0', '0', '0', '0', 100, 10, 100, 200, NULL,
         'sess_1', 'openai', 1, '1.0', 1780974000, 'proxy'),
        ('req_failed', 'provider_1', 'codex', 'new-model-special', 'new-model-special',
         9999, 9999, 0, 0, '0', '0', '0', '0', '0', 100, 10, 100, 500, 'failed',
         'sess_2', 'openai', 1, '1.0', 1780974300, 'proxy');
      `,
    ]);

    process.env.CODEX_HOME = path.join(root, "codex");
    process.env.CLAUDE_HOME = path.join(root, "claude");
    process.env.GEMINI_HOME = path.join(root, "gemini");
    process.env.OPENCODE_HOME = path.join(root, "opencode");
    process.env.CC_SWITCH_DB = dbPath;

    const result = await collectLocalUsage(root);

    expect(result.sources.find((source) => source.agent === "cc-switch")).toMatchObject({
      path: dbPath,
      files: 1,
      exists: true,
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      agent: "codex",
      model: "new-model-special",
      sessionId: "sess_1",
      totalTokens: 1500,
      timestamp: "2026-06-09T03:00:00.000Z",
      bucketStart: "2026-06-09T03:00:00.000Z",
    });

    const buckets = aggregateEvents(result.events, result.pricingProfiles);

    expect(buckets).toHaveLength(1);
    expect(buckets[0]).toMatchObject({
      model: "new-model-special",
      pricingStatus: "priced",
      cost: {
        inputUsd: "0.001200",
        cacheReadUsd: "0.000080",
        outputUsd: "0.000800",
        totalUsd: "0.002080",
      },
    });
  });
});
