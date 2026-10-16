import { describe, expect, it } from "vitest";

import { buildSyncCommand } from "../src/scheduler.js";

describe("auto-sync scheduler command", () => {
  it("runs the persistent CLI collector independently of Dashboard", () => {
    expect(buildSyncCommand("https://usage.example.com", {env:{},continuous:true})).toMatch(/tokenflow collect --watch$/);
  });

  it("migrates an existing scheduled CLI command while preserving its quoted runtime", () => {
    expect(buildSyncCommand("https://usage.example.com", {continuous:true,env:{TOKENFLOW_AUTO_SYNC_COMMAND:"'/path with spaces/node' '/path with spaces/cli.js' sync --auto"}})).toMatch(/'\/path with spaces\/node' '\/path with spaces\/cli.js' collect --watch$/);
  });
  it("uses the installed CLI instead of resolving npm on every scheduled run", () => {
    expect(
      buildSyncCommand("https://usage.example.com", {
        argvPath: "/private/var/folders/npm/_npx/123/node_modules/tokenusage/dist/cli.js",
        env: {},
      }),
    ).toBe(
      "PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' TOKENFLOW_SERVER_URL='https://usage.example.com' TOKENUSAGE_SERVER_URL='https://usage.example.com' tokenflow sync --auto",
    );
  });

  it("allows local installs to override the scheduled sync command", () => {
    expect(
      buildSyncCommand("http://127.0.0.1:8787", {
        argvPath: "/Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js",
        env: {
          TOKENFLOW_AUTO_SYNC_COMMAND:
            "node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto",
        },
      }),
    ).toBe(
      "PATH='/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' TOKENFLOW_SERVER_URL='http://127.0.0.1:8787' TOKENUSAGE_SERVER_URL='http://127.0.0.1:8787' node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto",
    );
  });

  it("adds Homebrew paths for launchd's minimal environment", () => {
    expect(
      buildSyncCommand("https://usage.example.com", {
        env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
      }),
    ).toBe(
      "PATH='/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin' TOKENFLOW_SERVER_URL='https://usage.example.com' TOKENUSAGE_SERVER_URL='https://usage.example.com' tokenflow sync --auto",
    );
  });
});
