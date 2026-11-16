import type { WebContents } from "electron";
import { setTimeout as delay } from "node:timers/promises";

const shellHealth = `(visible => {
  const toolbar = document.querySelector('.desktop-toolbar');
  return document.documentElement.dataset.tokenflowReady === 'true'
    && !!window.tokenflow && !!window.tokenflowDashboard
    && !!toolbar && toolbar.getBoundingClientRect().height > 0
    && (!visible || (getComputedStyle(toolbar).visibility === 'visible'
      && getComputedStyle(toolbar).display !== 'none'
      && !document.body.inert && getComputedStyle(document.body).visibility === 'visible'));
})`;

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Dashboard did not respond")), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export class DashboardRecovery {
  private pending: Promise<void> | null = null;
  private scheduled: NodeJS.Timeout | undefined;
  private attempts: number[] = [];
  private disposed = false;
  private restartRequired = false;
  private failureReported = false;
  private lastFailure = "";

  constructor(private readonly contents: WebContents, private readonly options: {
    url: string;
    active: () => boolean;
    stopping: () => boolean;
    log: (reason: string) => void;
    failed: (reason: string) => void;
  }) {
    contents.on("render-process-gone", (_event, details) => this.request(`Renderer exited: ${details.reason}`));
    contents.on("unresponsive", () => this.request("Renderer became unresponsive"));
    contents.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) this.request(`Page load failed: ${code} ${description}`);
    });
    contents.once("destroyed", () => this.dispose());
  }

  load(): Promise<void> { return this.run(() => this.loadPage(false)); }

  ensure(): Promise<void> {
    if (!this.options.active()) return Promise.resolve();
    return this.run(async () => {
      if (this.contents.getURL() === this.options.url && !this.contents.isCrashed() && !this.restartRequired) {
        const healthy = await within(this.contents.executeJavaScript(`${shellHealth}(true)`), 4_000).catch(() => false);
        if (healthy) return;
      }
      if (this.available()) await this.loadPage(true);
    });
  }

  retry(): Promise<void> {
    this.attempts = []; this.failureReported = false;
    return this.run(() => this.loadPage(true));
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.scheduled);
  }

  private available(): boolean {
    return !this.disposed && !this.contents.isDestroyed() && !this.options.stopping();
  }

  private run(action: () => Promise<void>): Promise<void> {
    if (!this.available()) return Promise.resolve();
    if (!this.pending) {
      clearTimeout(this.scheduled);
      this.scheduled = undefined;
      this.pending = Promise.resolve().then(action).finally(() => { this.pending = null; });
    }
    return this.pending;
  }

  private request(reason: string): void {
    if (!this.available()) return;
    this.restartRequired = true;
    this.lastFailure = reason;
    this.options.log(reason);
    if (this.pending || this.scheduled || !this.options.active()) return;
    this.scheduled = setTimeout(() => {
      this.scheduled = undefined;
      void this.ensure();
    }, 250);
  }

  private async loadPage(repair: boolean): Promise<void> {
    while (this.available()) {
      if (repair) {
        this.attempts = this.attempts.filter(time => Date.now() - time < 300_000);
        if (this.attempts.length >= 3) {
          if (!this.failureReported && this.options.active()) {
            this.failureReported = true;
            this.options.failed(this.lastFailure || "Dashboard remained blank or unresponsive");
          }
          return;
        }
        this.attempts.push(Date.now());
        this.options.log(`Reloading Dashboard (${this.attempts.length}/3): ${this.lastFailure || "Page health check failed"}`);
        if (!this.contents.isCrashed()) this.contents.forcefullyCrashRenderer();
      }
      this.restartRequired = false;
      try {
        await within(this.contents.loadURL(this.options.url), 20_000);
        const deadline = Date.now() + 10_000;
        while (this.available() && Date.now() < deadline) {
          if (await within(this.contents.executeJavaScript(`${shellHealth}(${this.options.active()})`), 4_000)) {
            this.restartRequired = false;
            this.failureReported = false;
            this.lastFailure = "";
            if (repair) this.options.log("Dashboard recovered");
            return;
          }
          await delay(100);
        }
        if (!this.available()) return;
        throw new Error("Dashboard shell did not become ready");
      } catch (error) {
        if (!this.available()) return;
        this.lastFailure = error instanceof Error ? error.message : String(error);
        this.options.log(this.lastFailure);
        repair = true;
      }
    }
  }
}
