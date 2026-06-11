import fs from "node:fs";

import { describe, expect, it } from "vitest";

describe("npm package", () => {
  it("builds the dist CLI before local installs and packed releases", () => {
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
      name?: string;
      publishConfig?: Record<string, string>;
      scripts?: Record<string, string>;
      version?: string;
    };

    expect(pkg.name).toBe("@renaissancemind/tokenflow");
    expect(pkg.version).toBe("0.2.3");
    expect(pkg.bin?.tokenflow).toBe("dist/cli.js");
    expect(pkg.bin?.tokenusage).toBe("dist/cli.js");
    expect(pkg.files).toContain("dist");
    expect(pkg.files).toContain("docs/i18n");
    expect(pkg.publishConfig?.access).toBe("public");
    expect(pkg.scripts?.prepare).toBe("npm run build");
  });
});
