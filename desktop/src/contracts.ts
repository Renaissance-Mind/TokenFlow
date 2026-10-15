import type { FetchProgress } from "./network-progress.js";
export interface ScanProgress { stage: "discovery" | "reading" | "processing"; discoveredFiles: number; processedFiles: number; totalFiles: number | null; readBytes: number; percent: number }
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
  windowChrome: { platform: string; fullScreen: boolean };
  cli: { source: "installed" | "managed"; version: string; path: string; compatible: boolean; updateStatus: string; availableVersion?: string };
  dashboardSource: "local" | "cloud";
  version: string;
  collectorVersion: string;
  settings: Settings;
  account: { name: string | null; email: string | null; id: string } | null;
  hasCollector: boolean;
  hasDashboard: boolean;
  busy: "scan" | "sync" | null;
  loginBusy: boolean;
  collectionPhase: "scan" | "pricing" | "upload" | null;
  collectionStartedAt: string | null;
  lastSyncAt: string | null;
  summary: LocalSummary | null;
  login: { code: string; expiresAt: string } | null;
  error: string | null;
  notice: string | null;
  pendingRequests: number;
  scanProgress: ScanProgress | null;
  fetchProgress: FetchProgress | null;
  requestProgress: { completed: number; total: number };
  settingsOpen: boolean;
  update: { status: string; version?: string; percent?: number; message?: string };
}
export interface DesktopSecret { serverUrl: string; desktopToken: string; deviceId: string }
