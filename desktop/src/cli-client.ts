import type { ScanProgress } from "./contracts.js";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { CliInstallation } from "./cli-installation.js";

export class CliClient {
  private active = new Set<ChildProcessWithoutNullStreams>();
  private background: ReturnType<typeof spawn> | null = null;
  constructor(public installation: CliInstallation, private fetcher: typeof fetch = fetch) {}
  startBackground(onError: (error: Error) => void): void {
    if (this.background) return;
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(this.installation.node, [this.installation.entrypoint, "collect", "--watch"], { env, stdio: "ignore", windowsHide: true });
    this.background = child;
    child.once("error", onError);
    child.once("close", code => {
      if (this.background !== child) return;
      this.background = null;
      if (code) onError(new Error(`Background CLI stopped (${code})`));
    });
  }
  async stopBackground(): Promise<void> {
    const child = this.background; this.background = null;
    if (!child) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
      child.once("close", () => { clearTimeout(timeout); resolve(); });
      child.kill();
    });
  }
  request<T = any>(action: string, params: Record<string, unknown> = {}, onPhase?: (phase: "scan" | "pricing" | "upload") => void, onProgress?: (progress: ScanProgress) => void): Promise<T> {
    if (!this.installation.compatible) return Promise.reject(new Error("Upgrade the installed CLI in Settings to enable local statistics."));
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(this.installation.node, [this.installation.entrypoint, "desktop-service"], { env, stdio: "pipe", windowsHide: true });
    this.active.add(child);
    return new Promise<T>((resolve, reject) => {
      let settled = false; let result: T; let failure: Error | null = null;
      const controllers = new Map<number, AbortController>();
      const timeout = setTimeout(() => { failure = new Error("CLI operation timed out"); child.kill(); }, 5 * 60_000);
      const lines = createInterface({ input: child.stdout });
      child.stderr.on("data", () => {}); // Never echo credentials or raw CLI output into the UI/log.
      lines.on("line", (line) => {
        let data: any;
        try { data = JSON.parse(line); } catch { failure = new Error("The CLI returned an invalid response"); child.kill(); return; }
        if (data.type === "progress") onProgress?.(data.progress);
        if (data.type === "phase") onPhase?.(data.phase);
        if (data.type === "http-abort") controllers.get(data.requestId)?.abort();
        if (data.type === "http") {
          const controller = new AbortController(); controllers.set(data.requestId, controller);
          void this.fetcher(data.url, { method: data.method, headers: data.headers, body: data.body, signal: controller.signal, redirect: "error" })
            .then(async (response) => ({ status: response.status, body: await response.text(), headers: Object.fromEntries(response.headers) }))
            .catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
            .then((response) => { controllers.delete(data.requestId); if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ type: "http-response", requestId: data.requestId, ...response })}\n`); });
        }
        if (data.type === "result") { settled = true; result = data.result; failure = data.error ? new Error(data.error) : null; child.stdin.end(); }
      });
      child.once("error", (error) => { failure = error; });
      child.once("close", (code) => {
        clearTimeout(timeout); lines.close(); this.active.delete(child); controllers.forEach((c) => c.abort());
        if (failure) reject(failure); else if (!settled || code !== 0) reject(new Error("CLI process stopped before completing the operation")); else resolve(result!);
      });
      child.stdin.on("error", () => {});
      child.stdin.write(`${JSON.stringify({ action, params, proxyHttp: true })}\n`);
    });
  }
  async stop(): Promise<void> {
    await Promise.all([...this.active].map((child) => new Promise<void>((resolve) => {
      const timeout = setTimeout(() => child.kill(), 10_000);
      child.once("close", () => { clearTimeout(timeout); resolve(); });
      if (!child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.write(`${JSON.stringify({ type: "cancel" })}\n`);
      else child.kill();
    })));
  }
}
