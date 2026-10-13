import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("tokenflow", Object.freeze({
  getState: () => ipcRenderer.invoke("tokenflow:state"),
  login: (provider: string) => ipcRenderer.invoke("tokenflow:login", provider),
  cancelLogin: () => ipcRenderer.invoke("tokenflow:cancel-login"),
  saveSettings: (settings: unknown) => ipcRenderer.invoke("tokenflow:settings", settings),
  sync: () => ipcRenderer.invoke("tokenflow:sync"),
  scan: () => ipcRenderer.invoke("tokenflow:scan"),
  dashboard: () => ipcRenderer.invoke("tokenflow:dashboard"),
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
