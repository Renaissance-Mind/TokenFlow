export interface Settings {
  serverUrl: string;
  deviceName: string;
  launchAtLogin: boolean;
  paused: boolean;
  trayMetric: "cost" | "tokens" | "icon";
  language: "en" | "zh";
}
export interface DayUsage { date: string; tokens: number; costUsd: number; unpricedTokens: number }
export interface LocalSummary {
  scannedAt: string;
  today: DayUsage;
  days: DayUsage[];
  agents: Array<{ agent: string; tokens: number; costUsd: number }>;
  sources: Array<{ agent: string; exists: boolean; files: number; path: string }>;
}
export interface DesktopState {
  version: string;
  collectorVersion: string;
  settings: Settings;
  account: { name: string | null; email: string | null; id: string } | null;
  hasCollector: boolean;
  hasDashboard: boolean;
  busy: "scan" | "sync" | "login" | null;
  lastSyncAt: string | null;
  summary: LocalSummary | null;
  login: { code: string; expiresAt: string } | null;
  error: string | null;
  notice: string | null;
  update: { status: string; version?: string; percent?: number; message?: string };
}
export interface DesktopSecret { serverUrl: string; desktopToken: string; deviceId: string }
