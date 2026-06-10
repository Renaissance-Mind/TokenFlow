import { describe, expect, it } from "vitest";

import { buildSyncCommand } from "../src/scheduler.js";

describe("auto-sync scheduler command", () => {
  it("uses the installed CLI instead of resolving npm on every scheduled run", () => {
    expect(
      buildSyncCommand("https://usage.example.com", {
        argvPath: "/private/var/folders/npm/_npx/123/node_modules/tokenusage/dist/cli.js",
        env: {},
      }),
    ).toBe(
      "PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' TOKENUSAGE_SERVER_URL='https://usage.example.com' tokenusage sync --auto",
    );
  });

  it("allows local installs to override the scheduled sync command", () => {
    expect(
      buildSyncCommand("http://127.0.0.1:8787", {
        argvPath: "/Users/chunqiu/Documents/workspace/TokenUsage/dist/cli.js",
        env: {
          TOKENUSAGE_AUTO_SYNC_COMMAND:
            "node /Users/chunqiu/Documents/workspace/TokenUsage/dist/cli.js sync --auto",
        },
      }),
    ).toBe(
      "PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' TOKENUSAGE_SERVER_URL='http://127.0.0.1:8787' node /Users/chunqiu/Documents/workspace/TokenUsage/dist/cli.js sync --auto",
    );
  });

  it("adds Homebrew paths for launchd's minimal environment", () => {
    expect(
      buildSyncCommand("https://usage.example.com", {
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      }),
    ).toBe(
      "PATH='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' TOKENUSAGE_SERVER_URL='https://usage.example.com' tokenusage sync --auto",
    );
  });
});
