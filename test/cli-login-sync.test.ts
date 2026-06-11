import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { main } from "../src/cli.js";

const originalEnv = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...originalEnv };
});

describe("CLI login initial sync", () => {
  it("syncs local usage immediately after device login succeeds", async () => {
    const root = await prepareUsageHome("tokenflow-login-sync-");
    const server = await startLoginServer();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await main(["login", "--server-url", server.url, "--device-name", "Test Laptop", "--no-open"]);
    } finally {
      await server.close();
    }

    const config = JSON.parse(await fs.readFile(path.join(root, "tokenflow", "config.json"), "utf8")) as {
      deviceToken?: string;
      deviceId?: string;
      lastSyncAt?: string;
    };
    expect(config.deviceToken).toBe("dev_token_test");
    expect(config.deviceId).toBe("dev_test");
    expect(config.lastSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(server.ingestCalls).toBe(1);
    expect(server.syncPingCalls).toBe(1);
    expect(server.uploadedBucketCount).toBe(3);
  });

  it("keeps device login link-only when --no-sync is provided", async () => {
    const root = await prepareUsageHome("tokenflow-login-no-sync-");
    const server = await startLoginServer();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await main(["login", "--server-url", server.url, "--device-name", "Test Laptop", "--no-open", "--no-sync"]);
    } finally {
      await server.close();
    }

    const config = JSON.parse(await fs.readFile(path.join(root, "tokenflow", "config.json"), "utf8")) as {
      deviceToken?: string;
      lastSyncAt?: string;
    };
    expect(config.deviceToken).toBe("dev_token_test");
    expect(config.lastSyncAt).toBeUndefined();
    expect(server.ingestCalls).toBe(0);
    expect(server.syncPingCalls).toBe(0);
  });

  it("syncs local usage immediately after read-write API token login succeeds", async () => {
    const root = await prepareUsageHome("tokenflow-api-token-login-sync-");
    const server = await startLoginServer();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    try {
      await main(["login", "--server-url", server.url, "--api-token", "tu_api_test"]);
    } finally {
      await server.close();
    }

    const config = JSON.parse(await fs.readFile(path.join(root, "tokenflow", "config.json"), "utf8")) as {
      apiToken?: string;
      lastSyncAt?: string;
    };
    expect(config.apiToken).toBe("tu_api_test");
    expect(config.lastSyncAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(server.ingestCalls).toBe(1);
    expect(server.syncPingCalls).toBe(1);
    expect(server.uploadedBucketCount).toBe(3);
  });
});

async function prepareUsageHome(prefix: string): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  process.env.TOKENFLOW_HOME = path.join(root, "tokenflow");
  process.env.CODEX_HOME = path.join(root, "codex");
  process.env.CLAUDE_HOME = path.join(root, "claude");
  process.env.GEMINI_HOME = path.join(root, "gemini");
  process.env.OPENCODE_HOME = path.join(root, "opencode");

  await fs.mkdir(path.join(root, "codex", "sessions", "2026", "06", "09"), { recursive: true });
  await fs.mkdir(path.join(root, "claude", "projects"), { recursive: true });
  await fs.mkdir(path.join(root, "gemini", "tmp"), { recursive: true });
  await fs.mkdir(path.join(root, "opencode"), { recursive: true });

  await fs.writeFile(
    path.join(root, "codex", "sessions", "2026", "06", "09", "rollout-2026-06-09T01-00-00-test.jsonl"),
    [
      JSON.stringify({ type: "session_meta", payload: { session_id: "codex-session" } }),
      JSON.stringify({ type: "turn_context", payload: { model: "OpenAI/GPT-5.2-Codex@HIGH" } }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-09T01:05:00.000Z",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 20,
              output_tokens: 30,
              reasoning_output_tokens: 5,
            },
          },
        },
      }),
    ].join("\n"),
  );

  return root;
}

async function startLoginServer(): Promise<{
  url: string;
  ingestCalls: number;
  syncPingCalls: number;
  uploadedBucketCount: number;
  close: () => Promise<void>;
}> {
  const state = {
    ingestCalls: 0,
    syncPingCalls: 0,
    uploadedBucketCount: 0,
  };
  const server = createServer(async (request, response) => {
    if (request.method === "POST" && request.url === "/api/device/start") {
      return json(response, {
        device_code: "device_code_test",
        user_code: "TEST-USER",
        verification_url: "https://tokenflow.example/device",
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        poll_interval_seconds: 0.001,
      });
    }
    if (request.method === "POST" && request.url === "/api/device/poll") {
      return json(response, {
        status: "approved",
        token: "dev_token_test",
        device_id: "dev_test",
      });
    }
    if (request.method === "GET" && request.url === "/api/me") {
      return json(response, {
        user: {
          id: "usr_test",
          email: "test@example.com",
          name: "Test User",
          api_key_scope: "read_write",
        },
      });
    }
    if (request.method === "POST" && request.url === "/api/ingest") {
      const body = await readJson(request);
      state.ingestCalls += 1;
      const daily = Array.isArray(body.daily) ? (body.daily as Array<{ slots?: unknown[] }>) : [];
      state.uploadedBucketCount += daily.reduce((total, day) => total + (Array.isArray(day.slots) ? day.slots.length : 0), 0);
      return json(response, { snapshot: true, accepted: state.uploadedBucketCount, updated: daily.length });
    }
    if (request.method === "POST" && request.url === "/api/sync-ping") {
      state.syncPingCalls += 1;
      return json(response, { ok: true });
    }

    response.statusCode = 404;
    return json(response, { error: "not found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP server did not bind to a TCP port");

  return {
    url: `http://127.0.0.1:${address.port}`,
    get ingestCalls() {
      return state.ingestCalls;
    },
    get syncPingCalls() {
      return state.syncPingCalls;
    },
    get uploadedBucketCount() {
      return state.uploadedBucketCount;
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) {
    raw += String(chunk);
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function json(response: ServerResponse, body: Record<string, unknown>): void {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
