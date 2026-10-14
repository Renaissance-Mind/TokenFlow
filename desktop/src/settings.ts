import type { Settings } from "./contracts.js";
import { normalizeDesktopServer } from "./auth.js";

// Connection settings belong to CLI config.json. Only App presentation and
// startup preferences are stored in the App's settings.json.
export function appSettings(settings: Partial<Settings>): Partial<Settings> {
  const result: Partial<Settings> = {};
  if (typeof settings.launchAtLogin === "boolean") result.launchAtLogin = settings.launchAtLogin;
  if (settings.trayMetric && ["cost", "tokens", "icon"].includes(settings.trayMetric)) result.trayMetric = settings.trayMetric;
  if (settings.language === "en" || settings.language === "zh") result.language = settings.language;
  return result;
}

export function sharedSettings(config: { serverUrl?: string; deviceName?: string; autoSyncPaused?: boolean } | null, defaults: Settings): Pick<Settings, "serverUrl" | "deviceName" | "paused"> {
  return {
    serverUrl: normalizeDesktopServer(config?.serverUrl || defaults.serverUrl),
    deviceName: config?.deviceName || defaults.deviceName,
    paused: config?.autoSyncPaused === true,
  };
}
