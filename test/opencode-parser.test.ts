import { describe, expect, it } from "vitest";
import { parseOpenCodeMessageRow } from "../src/sources/opencode.js";

describe("OpenCode usage parser", () => {
  it("extracts completed assistant token usage from an OpenCode message row", () => {
    const event = parseOpenCodeMessageRow({
      id: "msg_1",
      session_id: "sess_1",
      time_created: 1780974000000,
      data: JSON.stringify({
        role: "assistant",
        modelID: "anthropic/claude-sonnet-4-6-20260217",
        time: {
          created: 1780974000000,
          completed: 1780974010000,
        },
        tokens: {
          input: 100,
          output: 20,
          reasoning: 5,
          cache: {
            read: 30,
            write: 7,
          },
        },
      }),
    });

    expect(event).toMatchObject({
      agent: "opencode",
      model: "claude-sonnet-4-6",
      sessionId: "sess_1",
      inputTokens: 100,
      cachedInputTokens: 30,
      outputTokens: 20,
      reasoningOutputTokens: 5,
      cacheCreationTokens: 7,
      totalTokens: 162,
      timestamp: "2026-06-09T03:00:00.000Z",
      bucketStart: "2026-06-09T03:00:00.000Z",
    });
  });

  it("counts OpenCode rows with created timestamps even when completed is missing", () => {
    const event = parseOpenCodeMessageRow({
        id: "msg_2",
        session_id: "sess_1",
        time_created: 1780974000000,
        data: JSON.stringify({
          role: "assistant",
          modelID: "anthropic/claude-sonnet-4-6-20260217",
          time: { created: 1780974000000 },
          tokens: { input: 1 },
        }),
      });

    expect(event).toMatchObject({
      agent: "opencode",
      model: "claude-sonnet-4-6",
      sessionId: "sess_1",
      inputTokens: 1,
      timestamp: "2026-06-09T03:00:00.000Z",
      bucketStart: "2026-06-09T03:00:00.000Z",
    });
  });

  it("uses sessionID from standalone OpenCode message JSON", () => {
    const event = parseOpenCodeMessageRow(
      {
        id: "msg_file",
        session_id: "",
        data: JSON.stringify({
          id: "msg_file",
          sessionID: "sess_file",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
          time: { created: 1767312000000 },
          tokens: { input: 2, output: 3 },
        }),
      },
      "/tmp/opencode/storage/message/sess_file/msg_file.json",
    );

    expect(event).toMatchObject({
      agent: "opencode",
      sessionId: "sess_file",
      sourcePath: "/tmp/opencode/storage/message/sess_file/msg_file.json",
      inputTokens: 2,
      outputTokens: 3,
    });
  });
});
