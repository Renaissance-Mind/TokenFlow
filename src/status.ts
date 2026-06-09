import type { SourceStatus } from "./file-scan.js";

export interface RemoteDeviceStatus {
  linked: true;
  server_time: string;
  device: {
    id: string;
    name: string;
    platform: string;
    created_at: string;
    last_sync_at: string | null;
  };
  account: {
    id: string;
    email: string | null;
    name: string | null;
  };
}

export interface StatusReport {
  configPath: string;
  serverUrl: string;
  deviceId?: string;
  hasDeviceToken: boolean;
  lastSyncAt?: string;
  localEvents: number;
  localBuckets: number;
  sources: SourceStatus[];
  home: string;
  remote?: RemoteDeviceStatus;
}

export function formatStatus(report: StatusReport): string {
  return [
    "TokenUsage status",
    `Config: ${report.configPath}`,
    `Server: ${report.serverUrl}`,
    `Device: ${report.deviceId || "not linked"}`,
    `Token: ${report.hasDeviceToken ? "set" : "missing"}`,
    `Last sync: ${report.lastSyncAt || "never"}`,
    ...remoteLines(report.remote),
    `Local events: ${report.localEvents}`,
    `Local buckets: ${report.localBuckets}`,
    ...report.sources.map(
      (source) => `Source ${source.agent}: ${source.exists ? "found" : "missing"} (${source.files} files) ${source.path}`,
    ),
    `Home: ${report.home}`,
    "",
  ].join("\n");
}

function remoteLines(remote: RemoteDeviceStatus | undefined): string[] {
  if (!remote) return ["Remote: not checked"];
  return [
    "Remote: linked",
    `Remote account: ${remote.account.email || remote.account.name || remote.account.id}`,
    `Remote device: ${remote.device.name} (${remote.device.platform})`,
    `Remote last sync: ${remote.device.last_sync_at || "never"}`,
    `Remote server time: ${remote.server_time}`,
  ];
}
