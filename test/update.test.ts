import { describe, expect, it } from "vitest";
import { resolveUpdatePackageSpec } from "../src/update.js";

describe("update package source", () => {
  it("uses the npm package by default", () => {
    expect(resolveUpdatePackageSpec()).toBe("@renaissancemind/tokenusage@latest");
  });

  it("allows an explicit package source for local repository updates", () => {
    expect(resolveUpdatePackageSpec("/Users/chunqiu/Documents/workspace/TokenUsage")).toBe(
      "/Users/chunqiu/Documents/workspace/TokenUsage",
    );
  });

  it("falls back to an environment package source when provided", () => {
    expect(resolveUpdatePackageSpec(undefined, { TOKENUSAGE_UPDATE_SOURCE: "file:/opt/tokenusage" })).toBe(
      "file:/opt/tokenusage",
    );
  });
});
