import { describe, expect, it } from "vitest";

import { toIngestPayload } from "../src/ingest-payload.js";

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
});
