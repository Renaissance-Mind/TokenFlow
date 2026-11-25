interface DashboardRead {
  at: number;
  promise: Promise<any>;
  pending: boolean;
  successful: boolean;
}

export class DashboardRequests {
  private scope = "";
  private entries = new Map<string, DashboardRead>();
  constructor(private readonly ttl = 60_000) {}

  useScope(scope: string): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.invalidate();
  }

  fresh(endpoint: string, now = Date.now()): Promise<any> | undefined {
    const entry = this.entries.get(endpoint);
    return entry?.successful && now - entry.at < this.ttl ? entry.promise : undefined;
  }

  read(endpoint: string, fetch: () => Promise<any>, now = Date.now()): Promise<any> {
    const entry = this.entries.get(endpoint);
    if (entry && (entry.pending || now - entry.at < this.ttl)) return entry.promise;
    const request: DashboardRead = { at: now, pending: true, successful: false, promise: fetch() };
    request.promise.then(() => { request.pending = false; request.successful = true; }, () => { request.pending = false; });
    this.entries.set(endpoint, request);
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
    return request.promise;
  }

  remember(endpoint: string, value: unknown): void {
    this.entries.set(endpoint, { at: Date.now(), promise: Promise.resolve(value), pending: false, successful: true });
  }

  invalidate(): void { this.entries.clear(); }
}
