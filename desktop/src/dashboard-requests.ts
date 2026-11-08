// One network request per account/source revision and endpoint, shared by the
// native menu, popup, Dashboard and settings preview. A failed read is retried
// after the same interval, rather than on every renderer state notification.
export class DashboardRequests {
  private scope = "";
  private entries = new Map<string, { at: number; value: Promise<any> }>();
  constructor(private readonly ttl = 60_000) {}

  useScope(scope: string): void {
    if (this.scope === scope) return;
    this.scope = scope;
    this.entries.clear();
  }

  read(endpoint: string, fetch: () => Promise<any>, now = Date.now()): Promise<any> {
    const entry = this.entries.get(endpoint);
    if (entry && now - entry.at < this.ttl) return entry.value;
    const value = fetch();
    this.entries.set(endpoint, { at: now, value });
    if (this.entries.size > 128) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  invalidate(): void { this.entries.clear(); }
}
