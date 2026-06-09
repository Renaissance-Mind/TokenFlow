import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("npm package", () => {
  it("builds the dist CLI before local installs and packed releases", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
      scripts?: Record<string, string>;
    };

    expect(pkg.bin?.tokenusage).toBe("./dist/cli.js");
    expect(pkg.files).toContain("dist");
    expect(pkg.scripts?.prepare).toBe("npm run build");
  });
});
