import { describe, expect, it } from "vitest";
import { formatStatus } from "../src/status.js";

describe("status output", () => {
  it("includes remote account and device status when linked", () => {
    const output = formatStatus({
      configPath: "/home/user/.tokenusage/config.json",
      serverUrl: "https://usage.example.com",
      deviceId: "dev_123",
      hasDeviceToken: true,
      lastSyncAt: "2026-06-09T02:00:00.000Z",
      localEvents: 3,
      localBuckets: 2,
      sources: [
        {
          agent: "codex",
          path: "/home/user/.codex",
          exists: true,
          files: 1,
          events: 3,
        },
      ],
      home: "/home/user/.tokenusage",
      remote: {
        linked: true,
        server_time: "2026-06-09T03:00:00.000Z",
        device: {
          id: "dev_123",
          name: "Work Mac",
          platform: "darwin",
          created_at: "2026-06-09T01:00:00.000Z",
          last_sync_at: "2026-06-09T02:30:00.000Z",
        },
        account: {
          id: "usr_123",
          email: "user@example.com",
          name: "Chunqiu",
        },
      },
    });

    expect(output).toContain("Remote: linked");
    expect(output).toContain("Remote account: user@example.com");
    expect(output).toContain("Remote device: Work Mac (darwin)");
    expect(output).toContain("Remote last sync: 2026-06-09T02:30:00.000Z");
  });

  it("keeps local status visible when the remote status check fails", () => {
    const output = formatStatus({
      configPath: "/home/user/.tokenusage/config.json",
      serverUrl: "https://usage.example.com",
      deviceId: "dev_123",
      hasDeviceToken: true,
      lastSyncAt: "2026-06-09T02:00:00.000Z",
      localEvents: 7,
      localBuckets: 4,
      sources: [],
      home: "/home/user/.tokenusage",
      remoteError: "fetch failed",
    });

    expect(output).toContain("Remote: unavailable (fetch failed)");
    expect(output).toContain("Local events: 7");
    expect(output).toContain("Local buckets: 4");
  });
});
