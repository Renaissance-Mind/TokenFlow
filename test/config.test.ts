import { describe, expect, it } from "vitest";

import { DEFAULT_SERVER_URL, normalizeServerUrl } from "../src/config.js";

describe("server URL configuration", () => {
  it("uses the hosted production server by default", () => {
    expect(DEFAULT_SERVER_URL).toBe("https://tokenusage.renaissancemind.ai");
    expect(normalizeServerUrl(undefined)).toBe("https://tokenusage.renaissancemind.ai");
  });

  it("keeps explicit local development server URLs available", () => {
    expect(normalizeServerUrl("http://127.0.0.1:8787/")).toBe("http://127.0.0.1:8787");
  });
});
