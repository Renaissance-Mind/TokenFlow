import { describe, expect, it } from "vitest";
import { resolveUpdatePackageSpec } from "../src/update.js";

describe("update package source", () => {
  it("uses the npm package by default", () => {
    expect(resolveUpdatePackageSpec()).toBe("tokenflow@latest");
  });

  it("allows an explicit package source for local repository updates", () => {
    expect(resolveUpdatePackageSpec("/Users/chunqiu/Documents/workspace/TokenFlow")).toBe(
      "/Users/chunqiu/Documents/workspace/TokenFlow",
    );
  });

  it("falls back to an environment package source when provided", () => {
    expect(resolveUpdatePackageSpec(undefined, { TOKENFLOW_UPDATE_SOURCE: "file:/opt/tokenflow" })).toBe(
      "file:/opt/tokenflow",
    );
  });

  it("keeps the old TokenUsage environment variable as a compatibility fallback", () => {
    expect(resolveUpdatePackageSpec(undefined, { TOKENUSAGE_UPDATE_SOURCE: "file:/opt/tokenusage" })).toBe(
      "file:/opt/tokenusage",
    );
  });
});
