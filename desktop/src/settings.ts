import type { Settings } from "./contracts.js";
import { normalizeDesktopServer } from "./auth.js";

// Connection settings belong to CLI config.json. Only App presentation and
// startup preferences are stored in the App's settings.json.
export function appSettings(settings: Partial<Settings>): Partial<Settings> {
  const result: Partial<Settings> = {};
  if (typeof settings.launchAtLogin === "boolean") result.launchAtLogin = settings.launchAtLogin;
  if (settings.trayMetric && ["cost", "tokens", "icon"].includes(settings.trayMetric)) result.trayMetric = settings.trayMetric;
  if (settings.language === "en" || settings.language === "zh") result.language = settings.language;
  if (settings.trayRange && [1, 7, 30].includes(settings.trayRange)) result.trayRange = settings.trayRange;
  if (settings.trayTheme && ["system", "light", "dark"].includes(settings.trayTheme)) result.trayTheme = settings.trayTheme;
  if (Array.isArray(settings.trayWidgets)) {
    const widgets = [...new Set(settings.trayWidgets)].filter(item => ["overview", "trend", "models", "activity"].includes(item));
    if (widgets.length) result.trayWidgets = widgets;
  }
  return result;
}

export function sharedSettings(config: { serverUrl?: string; deviceName?: string; autoSyncPaused?: boolean } | null, defaults: Settings): Pick<Settings, "serverUrl" | "deviceName" | "paused"> {
  return {
    serverUrl: normalizeDesktopServer(config?.serverUrl || defaults.serverUrl),
    deviceName: config?.deviceName || defaults.deviceName,
    paused: config?.autoSyncPaused === true,
  };
}
