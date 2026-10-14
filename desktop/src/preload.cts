import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tokenflow", Object.freeze({
  getState: () => ipcRenderer.invoke("tokenflow:state"),
  login: (provider: string) => ipcRenderer.invoke("tokenflow:login", provider),
  cancelLogin: () => ipcRenderer.invoke("tokenflow:cancel-login"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("tokenflow:settings", settings),
  sync: () => ipcRenderer.invoke("tokenflow:sync"),
  scan: () => ipcRenderer.invoke("tokenflow:scan"),
  dashboard: () => ipcRenderer.invoke("tokenflow:dashboard"),
  dashboardRequest: (path: string, options?: unknown) => ipcRenderer.invoke("tokenflow:dashboard-request", path, options),
  setApiToken: (token: string) => ipcRenderer.invoke("tokenflow:api-token", token),
  checkCliUpdate: () => ipcRenderer.invoke("tokenflow:cli-update", "check"),
  upgradeCli: () => ipcRenderer.invoke("tokenflow:cli-update", "install"),
  logout: () => ipcRenderer.invoke("tokenflow:logout"),
  checkUpdate: () => ipcRenderer.invoke("tokenflow:update", "check"),
  downloadUpdate: () => ipcRenderer.invoke("tokenflow:update", "download"),
  installUpdate: () => ipcRenderer.invoke("tokenflow:update", "install"),
  openSettings: () => ipcRenderer.invoke("tokenflow:open-settings"),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("tokenflow:changed", listener);
    return () => ipcRenderer.removeListener("tokenflow:changed", listener);
  },
}));
