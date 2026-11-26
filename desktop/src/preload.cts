import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tokenflow", Object.freeze({
  getState: () => ipcRenderer.invoke("tokenflow:state"),
  login: (provider: string) => ipcRenderer.invoke("tokenflow:login", provider),
  cancelLogin: () => ipcRenderer.invoke("tokenflow:cancel-login"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("tokenflow:settings", settings),
  sync: () => ipcRenderer.invoke("tokenflow:sync"),
  scan: () => ipcRenderer.invoke("tokenflow:scan"),
  refreshDashboard: () => ipcRenderer.invoke("tokenflow:refresh-dashboard"),
  dashboard: () => ipcRenderer.invoke("tokenflow:dashboard"),
  dashboardRequest: (path: string, options?: unknown) => ipcRenderer.invoke("tokenflow:dashboard-request", path, options),
  sessionUsage: (from: string, to: string) => ipcRenderer.invoke("tokenflow:session-usage", from, to),
  setApiToken: (token: string) => ipcRenderer.invoke("tokenflow:api-token", token),
  checkCliUpdate: () => ipcRenderer.invoke("tokenflow:cli-update", "check"),
  upgradeCli: () => ipcRenderer.invoke("tokenflow:cli-update", "install"),
  logout: () => ipcRenderer.invoke("tokenflow:logout"),
  checkUpdate: () => ipcRenderer.invoke("tokenflow:update", "check"),
  downloadUpdate: () => ipcRenderer.invoke("tokenflow:update", "download"),
  installUpdate: () => ipcRenderer.invoke("tokenflow:update", "install"),
  openSettings: (section?: string) => ipcRenderer.invoke("tokenflow:open-settings", section),
  onSettingsSection: (callback: (section: string) => void) => {
    const listener=(_event: unknown, section: string)=>callback(section);
    ipcRenderer.on("tokenflow:settings-section",listener);
    return ()=>ipcRenderer.removeListener("tokenflow:settings-section",listener);
  },
  setTrayEditorActive: (active: boolean) => ipcRenderer.invoke("tokenflow:tray-editor-active", active),
  resizeTray: (height: number) => ipcRenderer.invoke("tokenflow:resize-tray", height),
  onDeviceMetadata: (callback: (value: unknown) => void) => {
    const listener = (_event: unknown, value: unknown) => callback(value);
    ipcRenderer.on("tokenflow:device-metadata", listener);
    return () => ipcRenderer.removeListener("tokenflow:device-metadata", listener);
  },
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("tokenflow:changed", listener);
    return () => ipcRenderer.removeListener("tokenflow:changed", listener);
  },
}));
