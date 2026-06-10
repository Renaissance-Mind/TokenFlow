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

  it("shows read-write API token upload mode without pretending a device status was checked", () => {
    const output = formatStatus({
      configPath: "/home/user/.tokenusage/config.json",
      serverUrl: "https://usage.example.com",
      hasDeviceToken: false,
      hasApiToken: true,
      localEvents: 7,
      localBuckets: 4,
      sources: [],
      home: "/home/user/.tokenusage",
    });

    expect(output).toContain("Token: set (read-write API)");
    expect(output).toContain("Remote: API token configured; device status not checked");
  });

  it("shows validated API token account and scope when checked", () => {
    const output = formatStatus({
      configPath: "/home/user/.tokenusage/config.json",
      serverUrl: "https://usage.example.com",
      hasDeviceToken: false,
      hasApiToken: true,
      localEvents: 7,
      localBuckets: 4,
      sources: [],
      home: "/home/user/.tokenusage",
      remoteApiToken: {
        authenticated: true,
        account: {
          id: "usr_123",
          email: "user@example.com",
          name: "Chunqiu",
        },
        scope: "read_write",
      },
    });

    expect(output).toContain("Remote: API token valid");
    expect(output).toContain("Remote account: user@example.com");
    expect(output).toContain("Remote API key scope: read-write");
  });

  it("surfaces unpriced local buckets so cost totals are not mistaken for complete billing", () => {
    const output = formatStatus({
      configPath: "/home/user/.tokenusage/config.json",
      serverUrl: "https://usage.example.com",
      hasDeviceToken: false,
      localEvents: 7,
      localBuckets: 4,
      unpricedBuckets: 2,
      sources: [],
      home: "/home/user/.tokenusage",
    });

    expect(output).toContain("Unpriced buckets: 2");
  });

  it("lists unpriced models by bucket count and token total", () => {
    const output = formatStatus({
      configPath: "/home/user/.tokenusage/config.json",
      serverUrl: "https://usage.example.com",
      hasDeviceToken: false,
      localEvents: 7,
      localBuckets: 4,
      unpricedBuckets: 2,
      unpricedModels: [
        {
          agent: "codex",
          model: "unknown-codex-preview",
          buckets: 9,
          totalTokens: 259_983_759,
        },
        {
          agent: "codex",
          model: "unknown",
          buckets: 2,
          totalTokens: 96_211_765,
        },
      ],
      sources: [],
      home: "/home/user/.tokenusage",
    });

    expect(output).toContain("Unpriced models:");
    expect(output).toContain("  codex/unknown-codex-preview: 9 buckets, 259983759 tokens");
    expect(output).toContain("  codex/unknown: 2 buckets, 96211765 tokens");
  });
});
