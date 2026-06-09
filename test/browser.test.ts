import { describe, expect, it } from "vitest";

import { tryOpenBrowser } from "../src/browser.js";

describe("browser opener", () => {
  it("does not throw when the system browser command is unavailable", () => {
    const opened = tryOpenBrowser("https://usage.example.com/device/verify", {
      platform: "linux",
      run: () => {
        throw new Error("xdg-open unavailable");
      },
    });

    expect(opened).toBe(false);
  });
});
