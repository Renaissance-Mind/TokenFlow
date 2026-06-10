import http from "node:http";
import { describe, expect, it } from "vitest";

import { ingestUsage, ingestUsageSnapshot } from "../src/api.js";
import { toIngestPayload } from "../src/ingest-payload.js";
import type { UsageBucket } from "../src/types.js";

describe("read-write API token uploads", () => {
  it("adds device metadata to ingest payloads when uploading with an API token", () => {
    const payload = toIngestPayload(
      [
        {
          agent: "codex",
          model: "gpt-5.2-codex",
          bucketStart: "2026-06-09T01:00:00.000Z",
          inputTokens: 10,
          cachedInputTokens: 3,
          outputTokens: 2,
          reasoningOutputTokens: 1,
          cacheCreationTokens: 0,
          totalTokens: 16,
          cost: {
            inputUsd: "0.000012",
            outputUsd: "0.000040",
            cacheReadUsd: "0.000001",
            cacheCreationUsd: "0.000000",
            totalUsd: "0.000053",
          },
        },
      ],
      { deviceName: "Work Mac", platform: "darwin" },
    );

    expect(payload).toMatchObject({
      device_name: "Work Mac",
      platform: "darwin",
      hourly: [
        {
          agent: "codex",
          total_tokens: 16,
        },
      ],
    });
  });

  it("uploads usage buckets in worker-safe ingest batches by default", async () => {
    const requests: Array<{ auth: string | undefined; body: unknown }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as { hourly: unknown[] };
        requests.push({ auth: request.headers.authorization, body });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ inserted: body.hourly.length, updated: 0 }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      const result = await ingestUsage({
        serverUrl: `http://127.0.0.1:${address.port}`,
        uploadToken: "tu_api_test",
        deviceName: "Work Mac",
        platform: "darwin",
        buckets: Array.from({ length: 21 }, (_, index) =>
          bucket(`2026-06-09T${String(index).padStart(2, "0")}:00:00.000Z`),
        ),
      });

      expect(result).toEqual({ inserted: 21, updated: 0, accepted: 21, supersededDaily: 0 });
      expect(requests).toHaveLength(2);
      expect(requests.map((request) => request.auth)).toEqual(["Bearer tu_api_test", "Bearer tu_api_test"]);
      expect(requests.map((request) => (request.body as { hourly: unknown[] }).hourly.length)).toEqual([20, 1]);
      expect(requests.map((request) => (request.body as { device_name?: string }).device_name)).toEqual([
        "Work Mac",
        "Work Mac",
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("uploads a complete usage snapshot in a single ingest request", async () => {
    const requests: Array<{ auth: string | undefined; body: Record<string, unknown> }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as Record<string, unknown>;
        requests.push({ auth: request.headers.authorization, body });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ snapshot: true, accepted: 21, updated: 1 }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      const result = await ingestUsageSnapshot({
        serverUrl: `http://127.0.0.1:${address.port}`,
        uploadToken: "tu_api_test",
        deviceName: "Work Mac",
        platform: "darwin",
        buckets: Array.from({ length: 21 }, (_, index) =>
          bucket(`2026-06-09T${String(index).padStart(2, "0")}:00:00.000Z`),
        ),
      });

      expect(result).toEqual({ accepted: 21, updated: 1 });
      expect(requests).toHaveLength(1);
      expect(requests[0].auth).toBe("Bearer tu_api_test");
      expect(requests[0].body).toMatchObject({
        device_name: "Work Mac",
        platform: "darwin",
        snapshot_version: "daily-v1",
      });
      expect((requests[0].body.daily as unknown[])).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("retries transient network failures while uploading usage", async () => {
    let requests = 0;
    const server = http.createServer((request, response) => {
      requests += 1;
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        if (requests === 1) {
          request.socket.destroy();
          return;
        }

        const body = JSON.parse(raw) as { hourly: unknown[] };
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ inserted: body.hourly.length, updated: 0 }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      const result = await ingestUsage({
        serverUrl: `http://127.0.0.1:${address.port}`,
        uploadToken: "tu_api_test",
        buckets: [bucket("2026-06-09T01:00:00.000Z")],
      });

      expect(result).toEqual({ inserted: 1, updated: 0, accepted: 1, supersededDaily: 0 });
      expect(requests).toBe(2);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("sends unknown replacement scopes only for safe Codex days across upload batches", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as { hourly: unknown[] };
        requests.push({ body });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ inserted: body.hourly.length, updated: 0 }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      await ingestUsage({
        serverUrl: `http://127.0.0.1:${address.port}`,
        uploadToken: "tu_api_test",
        buckets: [
          bucket("2026-05-13T00:00:00.000Z", "gpt-5.5"),
          bucket("2026-05-14T00:00:00.000Z", "gpt-5.5"),
          bucket("2026-05-14T00:00:00.000Z", "unknown"),
        ],
        chunkSize: 1,
      });

      expect(requests.map((request) => request.body.replace_unknown_buckets)).toEqual([
        [{ agent: "codex", bucket_start: "2026-05-13T00:00:00.000Z", granularity: "half_hour" }],
        undefined,
        undefined,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("sends day-level unknown replacement scopes even when there are no bucket rows to upload", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as { hourly: unknown[] };
        requests.push({ body });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ accepted: body.hourly.length, superseded_daily: 0 }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      await ingestUsage({
        serverUrl: `http://127.0.0.1:${address.port}`,
        uploadToken: "tu_api_test",
        buckets: [],
        replaceUnknownBuckets: [
          { agent: "codex", bucket_start: "2026-05-13T00:00:00.000Z", granularity: "day" },
        ],
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body).toMatchObject({
        hourly: [],
        replace_unknown_buckets: [
          { agent: "codex", bucket_start: "2026-05-13T00:00:00.000Z", granularity: "day" },
        ],
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("chunks daily replacement scopes so each ingest request stays worker-safe", async () => {
    const requests: Array<{ body: Record<string, unknown> }> = [];
    const server = http.createServer((request, response) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        const body = JSON.parse(raw) as { replace_daily_buckets?: unknown[]; hourly: unknown[] };
        requests.push({ body });
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ accepted: body.hourly.length, superseded_daily: body.replace_daily_buckets?.length || 0 }));
      });
    });

    try {
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("missing server address");

      const result = await ingestUsage({
        serverUrl: `http://127.0.0.1:${address.port}`,
        uploadToken: "tu_api_test",
        buckets: [],
        replaceDailyBuckets: Array.from({ length: 21 }, (_, index) => ({
          agent: "codex",
          model: "gpt-5.2-codex",
          bucket_start: `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        })),
      });

      expect(result.supersededDaily).toBe(21);
      expect(requests.map((request) => request.body.replace_daily_buckets as unknown[] | undefined).map((items) => items?.length)).toEqual([
        20,
        1,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});

function bucket(bucketStart: string, model = "gpt-5.2-codex"): UsageBucket {
  return {
    agent: "codex",
    model,
    bucketStart,
    inputTokens: 10,
    cachedInputTokens: 3,
    outputTokens: 2,
    reasoningOutputTokens: 1,
    cacheCreationTokens: 0,
    totalTokens: 16,
    cost: {
      inputUsd: "0.000012",
      outputUsd: "0.000040",
      cacheReadUsd: "0.000001",
      cacheCreationUsd: "0.000000",
      totalUsd: "0.000053",
    },
    pricingStatus: "priced",
  };
}
