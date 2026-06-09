import { execFileSync } from "node:child_process";

export interface BrowserOpenOptions {
  platform?: NodeJS.Platform | string;
  run?: typeof execFileSync;
}

export function tryOpenBrowser(url: string, options: BrowserOpenOptions = {}): boolean {
  const platform = options.platform || process.platform;
  const run = options.run || execFileSync;
  const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    run(command, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
