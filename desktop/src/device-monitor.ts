export interface ReportDevice {
  id: string;
  name: string;
  platform: string;
  status: string;
  last_sync_at: string | null;
  revoked_at: string | null;
  usage_revision?: string | null;
}

export interface DeviceList { devices: ReportDevice[] }

export function deviceUsageVersion(list: DeviceList, pricingVersion: string | null): string {
  const versions = list.devices.map(d => [d.id, d.name, d.platform, d.revoked_at, d.usage_revision ?? d.last_sync_at]);
  versions.sort(([a], [b]) => String(a).localeCompare(String(b)));
  return JSON.stringify([pricingVersion, versions]);
}

export class DeviceMonitor {
  private scope = "";
  private version: string | undefined;
  private lastAttempt = -Infinity;
  private pending?: Promise<DeviceList>;
  private lastRead?: Promise<DeviceList>;
  private lastSuccess = -Infinity;
  current?: DeviceList;
  generation = 0;

  useScope(scope: string): void {
    if (this.scope !== scope) {
      this.scope = scope;
      this.reset();
    }
  }

  reset(): void {
    this.generation++;
    this.version = undefined;
    this.current = undefined;
    this.pending = undefined;
    this.lastRead = undefined;
    this.lastSuccess = -Infinity;
    this.lastAttempt = -Infinity;
  }

  nextCheck(visible: boolean): number | undefined {
    return this.pending ? undefined : this.lastAttempt + (visible ? 60_000 : 300_000);
  }

  fresh(now = Date.now()): DeviceList | undefined {
    return now - this.lastSuccess < 60_000 ? this.current : undefined;
  }

  read(
    fetch: () => Promise<{ list: DeviceList; pricingVersion: string | null }>,
    accept: (list: DeviceList, usageChanged: boolean, metadataChanged: boolean) => void,
    now = Date.now(),
  ): Promise<DeviceList> {
    if (this.pending) return this.pending;
    if (this.lastRead && now - this.lastAttempt < 60_000) return this.lastRead;
    this.lastAttempt = now;
    // Defer network progress notifications until the in-flight request is shared.
    const pending = Promise.resolve().then(fetch).then(({ list, pricingVersion }) => {
      if (this.pending === pending) {
        const version = deviceUsageVersion(list, pricingVersion);
        const changed = this.version !== undefined && this.version !== version;
        const metadataChanged = JSON.stringify(this.current) !== JSON.stringify(list);
        this.lastSuccess = now;
        this.current = list;
        this.version = version;
        accept(list, changed, metadataChanged);
      }
      return list;
    }).finally(() => { if (this.pending === pending) this.pending = undefined; });
    this.lastRead = this.pending = pending;
    return pending;
  }
}
