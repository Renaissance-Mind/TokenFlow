import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function sameRendererLocation(value: string, renderer: string): boolean {
  const url = new URL(value);
  if (url.protocol !== "file:") return false;
  const actual = fileURLToPath(url);
  if (path.basename(actual) !== "index.html" || path.basename(path.dirname(actual)) !== "renderer") return false;
  // The application root is a real directory or ASAR file; resolve its short-path
  // and symlink aliases before comparing the virtual renderer path inside it.
  const expectedRoot = realpathSync.native(path.dirname(path.dirname(renderer)));
  const actualRoot = realpathSync.native(path.dirname(path.dirname(actual)));
  return process.platform === "win32" ? actualRoot.toLowerCase() === expectedRoot.toLowerCase() : actualRoot === expectedRoot;
}
