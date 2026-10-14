import { NetworkProgress } from "./network-progress.js";
import { app, BrowserWindow, WebContentsView, Menu, Tray, nativeImage, ipcMain, shell, screen, session, safeStorage, powerMonitor, dialog, net, protocol } from "electron";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import updater from "electron-updater";
import fs from "node:fs/promises";
import { realpathSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError, apiRequest, checkedLoginUrl, createPkce, normalizeDesktopServer, setDesktopHttpClient } from "./auth.js";
import type { DesktopSecret, DesktopState, LocalSummary, Settings } from "./contracts.js";
import { sameRendererLocation } from "./ipc-origin.js";
import { CliClient } from "./cli-client.js";
import { collectorHome, findCli, installCli, rememberCli, type CliInstallation } from "./cli-installation.js";
import { appSettings, sharedSettings } from "./settings.js";

const { autoUpdater } = updater;
const here = path.join(realpathSync.native(app.getAppPath()), "app");
const renderer = path.join(here, "../renderer/index.html");
app.setName("TokenFlow");
protocol.registerSchemesAsPrivileged([{ scheme: "tokenflow", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (process.env.TOKENFLOW_DESKTOP_DATA) app.setPath("userData", path.resolve(process.env.TOKENFLOW_DESKTOP_DATA));
const collectorOnly = process.argv.includes("--collector-sync");
if (!collectorOnly && !app.requestSingleInstanceLock()) app.exit(0);

let settingsView: WebContentsView | null = null;
let dashboardWindow: BrowserWindow | null = null;
let openingDashboard: Promise<void> | null = null;
let popup: BrowserWindow | null = null;
let tray: Tray;
let cli: CliClient;
let installation: CliInstallation | null = null;
let dataHome = "";
let collectionTask: Promise<void> | null = null;
let stoppingCollection = false;
let configWatcher: FSWatcher | undefined;
let watchedAuthorization = "";
let changingCollector = false;
let secret: DesktopSecret | null = null;
let dashboardAuthKind = "";
let dashboardBearer: string | null = null;
let loginController: AbortController | null = null;
let shuttingDown = false;
let loggingOut = false;
let ready = false;
const timers: NodeJS.Timeout[] = [];
const dashboardSession = () => session.fromPartition("persist:tokenflow-dashboard");
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");
const secretPath = () => path.join(app.getPath("userData"), "desktop-auth.bin");
const pendingSecretPath = () => path.join(app.getPath("userData"), "desktop-auth.pending.bin");
const runtime = app.isPackaged ? path.join(realpathSync.native(process.resourcesPath), "collector") : path.resolve(here, "../collector");
const standaloneNode = () => process.env.TOKENFLOW_NODE_PATH || (app.isPackaged ? path.join(realpathSync.native(process.resourcesPath), `node-${process.arch}`, process.platform === "win32" ? "node.exe" : "node") : "");
const defaultSettings: Settings = {
  serverUrl: process.env.TOKENFLOW_SERVER_URL || "https://tokenflow.renaissancemind.ai", deviceName: os.hostname(), launchAtLogin: true,
  paused: false, trayMetric: "cost", language: app.getLocale().startsWith("zh") ? "zh" : "en",
};
const state: DesktopState = {
  version: app.getVersion(), collectorVersion: "", cli: { source: "managed", version: "", path: "", compatible: true, updateStatus: "idle" }, dashboardSource: "local", settings: { ...defaultSettings },
  account: null, hasCollector: false, hasDashboard: false, busy: null, lastSyncAt: null,
  summary: null, login: null, loginBusy: false, collectionPhase: null, collectionStartedAt: null,
  error: null, notice: null, pendingRequests: 0, scanProgress: null, fetchProgress: null, requestProgress: { completed: 0, total: 0 }, settingsOpen: false, update: { status: "idle" },
};

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function readOptional(file: string): Promise<Buffer | null> {
  return fs.readFile(file).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
}
async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, data, { mode: 0o600 });
  await fs.rename(temp, file);
}
async function stageSecret(value: DesktopSecret): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("The operating system credential store is unavailable. Unlock it and sign in again.");
  await atomicWrite(pendingSecretPath(), safeStorage.encryptString(JSON.stringify(value)));
}
function emit(): void {
  for (const contents of [dashboardWindow?.webContents, settingsView?.webContents, popup?.webContents]) if (contents && !contents.isDestroyed()) contents.send("tokenflow:changed", state);
  if (!tray || tray.isDestroyed()) return;
  const today = state.summary?.today;
  const currentDay = today?.date === new Date().toLocaleDateString("en-CA");
  const tokens = currentDay && today ? compactTokens(today.tokens) : "—";
  const cost = currentDay && today ? `$${today.costUsd.toFixed(2)}` : "—";
  const text = state.settings.trayMetric === "tokens" ? tokens : cost;
  if (process.platform === "darwin") tray.setTitle(state.settings.trayMetric === "icon" ? "" : text, { fontType: "monospacedDigit" });
  tray.setToolTip(`TokenFlow · ${cost} · ${tokens} tokens${state.settings.paused ? " · paused" : ""}${state.error ? `\n${state.error}` : ""}`);
  const panel = Menu.getApplicationMenu()?.getMenuItemById("status-panel");
  if (panel) panel.label = `Status panel${process.platform === "darwin" && tray.getTitle() ? ` · ${tray.getTitle()}` : ""}`;
}
function compactTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}
function allowedWebUrl(value: string): boolean { return /^https?:\/\//.test(value) && ["http:", "https:"].includes(new URL(value).protocol); }
function protectLocalContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function localPreferences() {
  return { preload: path.join(here, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
}
async function showSettings(): Promise<void> {
  popup?.hide();
  await showDashboard();
  const win = dashboardWindow!;
  if (!settingsView || settingsView.webContents.isDestroyed()) {
    settingsView = new WebContentsView({ webPreferences: localPreferences() });
    protectLocalContents(settingsView.webContents);
    win.contentView.addChildView(settingsView);
    settingsView.setBackgroundColor("#ffffff");
    const resize = () => { const { width, height } = win.getContentBounds(); settingsView?.setBounds({ x: 0, y: 0, width, height }); };
    win.on("resize", resize); resize();
    await settingsView.webContents.loadFile(renderer, { query: { mode: "settings" } });
  }
  settingsView.setVisible(true); state.settingsOpen = true; win.setTitle("TokenFlow · Settings");
  win.show(); win.focus(); settingsView.webContents.focus(); emit();
}
function useLocalData(): void {
  state.dashboardSource = "local"; emit();
}
function togglePopup(): void {
  if (popup?.isVisible()) { popup.hide(); return; }
  if (!popup || popup.isDestroyed()) {
    popup = new BrowserWindow({ width: 380, height: 520, frame: false, resizable: false, show: false,
      skipTaskbar: true, alwaysOnTop: true, backgroundColor: "#0b0e15", webPreferences: localPreferences() });
    protectLocalContents(popup.webContents);
    popup.on("blur", () => popup?.hide());
    void popup.loadFile(renderer, { query: { mode: "tray" } });
  }
  const bounds = tray.getBounds();
  const area = screen.getDisplayMatching(bounds).workArea;
  const size = popup.getBounds();
  const below = bounds.y < area.y + area.height / 2;
  popup.setPosition(Math.round(Math.min(Math.max(bounds.x + bounds.width / 2 - size.width / 2, area.x), area.x + area.width - size.width)),
    Math.round(below ? Math.max(area.y, bounds.y + bounds.height + 6) : Math.min(area.y + area.height - size.height, bounds.y - size.height - 6)));
  popup.show(); popup.focus(); emit();
  if (!state.busy && (!state.summary || Date.now() - Date.parse(state.summary.scannedAt) > 60_000)) void runJob("scan");
}
function showDashboard(): Promise<void> {
  if (!openingDashboard) openingDashboard = openDashboard().finally(() => { openingDashboard = null; });
  return openingDashboard;
}
async function openDashboard(): Promise<void> {
  popup?.hide();
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 640,
      title: "TokenFlow Dashboard", backgroundColor: "#ffffff", show: false, autoHideMenuBar: true, webPreferences: localPreferences() });
    protectLocalContents(dashboardWindow.webContents);
    dashboardWindow.on("close", (event) => { if (!shuttingDown) { event.preventDefault(); dashboardWindow!.hide(); } });
    dashboardWindow.on("closed", () => { settingsView?.webContents.close(); settingsView = null; dashboardWindow = null; });
    await dashboardWindow.loadURL("tokenflow://dashboard/index.html?mode=dashboard");
  }
  if (state.hasDashboard) state.dashboardSource = "cloud";
  settingsView?.setVisible(false); state.settingsOpen = false; dashboardWindow.setTitle("TokenFlow Dashboard");
  dashboardWindow.show(); dashboardWindow.focus(); emit();
}
async function trackRequest<T>(action: () => Promise<T>): Promise<T> {
  if (!state.pendingRequests) state.requestProgress = { completed: 0, total: 0 };
  state.requestProgress.total++; state.pendingRequests++; emit();
  try { return await action(); }
  finally { state.pendingRequests--; state.requestProgress.completed++; emit(); }
}
const networkProgress = new NetworkProgress(progress => { state.fetchProgress = progress; emit(); });
const desktopFetch: typeof fetch = (input, init) => networkProgress.fetch(input, init, (url, options) => net.fetch(url as string, options));
async function dashboardRequest(value: unknown, options: any = {}): Promise<any> {
  if (typeof value !== "string") throw new Error("Invalid Dashboard request");
  const url = new URL(value, "https://tokenflow.local");
  const allowed = ["/api/me", "/api/devices", "/api/usage/summary", "/api/usage/heatmap", "/api/usage/hourly", "/api/profile/persona"];
  const persona = url.pathname === "/api/profile/persona";
  if (url.origin !== "https://tokenflow.local" || !allowed.includes(url.pathname) || (persona ? options.method !== "PATCH" : options.method && options.method !== "GET")) throw new Error("Unsupported Dashboard request");
  if (persona) {
    const key = JSON.parse(String(options.body)).persona_key;
    if (key !== null && (typeof key !== "string" || !/^[a-z0-9_-]{1,64}$/.test(key))) throw new Error("Invalid persona preference");
    if (state.dashboardSource === "local" || dashboardAuthKind === "device" || dashboardAuthKind === "api_key") { await atomicWrite(path.join(app.getPath("userData"), "dashboard-persona.json"), JSON.stringify({ persona_key: key })); return { persona_key: key }; }
  }
  const endpoint = url.pathname + url.search;
  const authorization = watchedAuthorization;
  if (state.hasDashboard && state.dashboardSource === "cloud") {
    try {
      const response = await networkProgress.fetch(state.settings.serverUrl + endpoint, { ...(persona ? { method: "PATCH", body: options.body } : {}), headers: { Authorization: `Bearer ${dashboardBearer}`, ...(persona ? { "Content-Type": "application/json" } : {}) }, credentials: "omit", redirect: "error", signal: AbortSignal.timeout(15_000) }, (url, init) => dashboardSession().fetch(url as string, init));
      const data = await response.json() as any;
      if (authorization !== watchedAuthorization) return dashboardRequest(value, options);
      if (!response.ok || (url.pathname === "/api/me" && !data.authenticated)) throw new ApiError(data.error || "Dashboard request failed", response.status || 401);
      if (url.pathname === "/api/me") {
        const preference = await readOptional(path.join(app.getPath("userData"), "dashboard-persona.json"));
        if (preference) data.user.persona_key = JSON.parse(preference.toString()).persona_key;
      }
      return data;
    } catch (error) {
      if (authorization !== watchedAuthorization) return dashboardRequest(value, options);
      if (persona || (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 401)) throw error;
      if (error instanceof ApiError && error.status === 401) { state.hasDashboard = false; state.account = null; }
      state.notice = "Synced data is unavailable. Showing this device’s data.";
      useLocalData();
    }
  }
  const data = await cli.request("dashboard", { path: endpoint });
  if (url.pathname === "/api/me") {
    const preference = await readOptional(path.join(app.getPath("userData"), "dashboard-persona.json"));
    if (preference) data.user.persona_key = JSON.parse(preference.toString()).persona_key;
  }
  return data;
}
async function marker(): Promise<void> {
  if (installation?.compatible) await cli.request("owner", { pid: state.hasCollector ? process.pid : null });
}
async function stopCollection(): Promise<void> {
  const task = collectionTask;
  if (!task) return;
  stoppingCollection = true;
  try { await cli.stop(); await task; } finally { stoppingCollection = false; }
}
async function readCollector(): Promise<any> {
  if (installation?.compatible) return cli.request("state");
  const raw = await readOptional(path.join(dataHome, "config.json"));
  return { config: raw ? JSON.parse(raw.toString()) : null, home: dataHome, summary: null };
}
async function refreshCollector(): Promise<any> {
  const result = await readCollector(); const config = result.config;
  state.hasCollector = Boolean(config?.apiToken || config?.deviceToken);
  state.lastSyncAt = config?.lastSyncAt || null;
  state.settings = { ...state.settings, ...sharedSettings(config, defaultSettings) };
  return config;
}
async function reconcileCollector(): Promise<void> {
  if (state.loginBusy || changingCollector || loggingOut || shuttingDown || state.cli.updateStatus === "installing") return;
  changingCollector = true;
  try {
    const current = await findCli({ fallbackNode: standaloneNode() });
    if (current?.compatible && (current.entrypoint !== installation?.entrypoint || current.version !== installation?.version)) {
      await stopCollection(); await selectCli(current); await configureScheduler(); emit();
    }
    if (!installation?.compatible) return;
    const previousSettings = JSON.stringify(state.settings);
    let config = await refreshCollector();
    const changed = JSON.stringify([config?.serverUrl, config?.apiToken, config?.deviceToken]) !== watchedAuthorization;
    if (!changed && ((!state.hasCollector) || (state.hasDashboard && state.dashboardSource === "cloud") || state.busy)) {
      if (JSON.stringify(state.settings) !== previousSettings) emit();
      return;
    }
    if (changed) {
      await stopCollection(); config = await refreshCollector();
      watchedAuthorization = JSON.stringify([config?.serverUrl, config?.apiToken, config?.deviceToken]);
      state.hasDashboard = false; state.account = null; dashboardBearer = null; useLocalData();
      if (secret && (secret.deviceId !== config?.deviceId || secret.serverUrl !== config?.serverUrl)) {
        secret = null; await fs.rm(secretPath(), { force: true });
      }
    }
    try { await configureCliDashboard(config); } catch (error) { state.notice = message(error); }
    await marker(); await configureScheduler(); emit();
  } finally { changingCollector = false; }
}
async function startLogin(provider: unknown): Promise<void> {
  if (provider !== "github" && provider !== "google") throw new Error("Choose GitHub or Google");
  if (loginController || loggingOut || shuttingDown) throw new Error("Wait for the current sign-in to finish");
  const controller = new AbortController(); loginController = controller;
  state.loginBusy = true; state.error = null; emit();
  try {
    await stopCollection();
    controller.signal.throwIfAborted();
    const pkce = createPkce();
    const config = (await readCollector()).config;
    const existing = config?.serverUrl === state.settings.serverUrl ? config.deviceToken : undefined;
    const start = await apiRequest(state.settings.serverUrl, "/api/desktop/start", {
      provider, code_challenge: pkce.challenge, device_name: state.settings.deviceName, platform: process.platform,
    }, existing, controller.signal);
    if (typeof start.code !== "string" || typeof start.user_code !== "string" || !Number.isFinite(Date.parse(start.expires_at))) throw new Error("Server returned an invalid login request");
    state.login = { code: start.user_code, expiresAt: start.expires_at }; emit();
    await shell.openExternal(checkedLoginUrl(start.login_url, state.settings.serverUrl, provider));
    void pollLogin(start, pkce.verifier, existing, controller);
  } catch (error) {
    if (loginController === controller) { state.loginBusy = false; state.login = null; loginController = null; }
    if (!controller.signal.aborted) throw error;
  }
}
async function pollLogin(flow: any, verifier: string, existing: string | undefined, controller: AbortController): Promise<void> {
  try {
    while (Date.now() < Date.parse(flow.expires_at)) {
      await delay(Math.max(1, Math.min(Number(flow.poll_interval_seconds) || 3, 10)) * 1000, undefined, { signal: controller.signal });
      const result = await apiRequest(state.settings.serverUrl, "/api/desktop/poll", { code: flow.code, code_verifier: verifier }, existing, controller.signal);
      if (result.status === "pending") continue;
      if (result.status !== "approved" || typeof result.device_id !== "string" || typeof result.desktop_token !== "string" || !result.desktop_token.startsWith("tu_desktop_")) throw new Error("Server returned an invalid desktop authorization");
      const token = result.reuse_device ? existing : result.device_token;
      if (typeof token !== "string" || !token.startsWith("tu_dev_")) throw new Error("Server returned an invalid collector authorization");
      const nextSecret = { serverUrl: state.settings.serverUrl, desktopToken: result.desktop_token, deviceId: result.device_id };
      await stageSecret(nextSecret);
      await cli.request("authorize", { serverUrl: state.settings.serverUrl, token,
        deviceId: result.device_id, deviceName: state.settings.deviceName });
      watchedAuthorization = JSON.stringify([state.settings.serverUrl, undefined, token]);
      await fs.rename(pendingSecretPath(), secretPath()); secret = nextSecret;
      await configureCliDashboard((await readCollector()).config);
      state.hasCollector = true; state.notice = null;
      await marker(); configureLoginItem(); await configureScheduler();
      await showDashboard();
      return;
    }
    throw new Error("Login expired. Sign in again.");
  } catch (error) { if (!controller.signal.aborted) state.error = message(error); }
  finally {
    if (loginController === controller) {
      loginController = null; state.login = null; state.loginBusy = false; emit();
      if (state.hasCollector && state.hasDashboard && !state.settings.paused) void runJob("sync");
    }
  }
}
function configureLoginItem(): void {
  if (app.isPackaged && (!process.env.TOKENFLOW_DESKTOP_DATA || process.env.TOKENFLOW_SYSTEM_TEST === "1") && ["darwin", "win32"].includes(process.platform)) {
    app.setLoginItemSettings({ openAtLogin: state.settings.launchAtLogin, args: ["--background"] });
  }
}
async function configureScheduler(): Promise<void> {
  if (app.isPackaged && !process.env.TOKENFLOW_DESKTOP_DATA && state.hasCollector && installation?.compatible) {
    await cli.request("scheduler", { serverUrl: state.settings.serverUrl });
  }
}
async function selectCli(value: CliInstallation): Promise<void> {
  await rememberCli(value);
  installation = value; cli = new CliClient(value, desktopFetch);
  state.collectorVersion = value.version;
  state.cli = { source: value.source, version: value.version, path: value.entrypoint, compatible: value.compatible,
    updateStatus: value.compatible ? "idle" : "required" };
}
async function upgradeCli(): Promise<void> {
  if (state.cli.updateStatus === "installing" || state.loginBusy) return;
  await stopCollection(); state.cli.updateStatus = "installing"; state.error = null; emit();
  try {
    const bundled = JSON.parse(await fs.readFile(path.join(runtime, "package.json"), "utf8"));
    if (state.cli.availableVersion && state.cli.availableVersion !== bundled.version) {
      throw new Error("A newer CLI is available on npm. Run tokenflow update, or update App to get that CLI version.");
    }
    // Upgrade the existing installation in place. Its terminal command and login survive.
    const value = await installCli(runtime, standaloneNode() || installation!.node, { replace: installation?.source === "installed" ? installation : undefined, copyRuntime: app.isPackaged });
    await selectCli(value); state.cli.updateStatus = "current";
    await refreshCollector(); await configureScheduler(); await marker();
    void runJob(state.hasCollector ? "sync" : "scan");
  } catch (error) { state.cli.updateStatus = "error"; throw error; }
}
async function checkCliUpdate(): Promise<void> {
  state.cli.updateStatus = "checking"; emit();
  try {
    const response = await desktopFetch("https://registry.npmjs.org/@renaissancemind%2Ftokenflow/latest", { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Unable to check CLI updates");
    const pkg = await response.json() as { version: string };
    const bundled = JSON.parse(await fs.readFile(path.join(runtime, "package.json"), "utf8"));
    const newer = (a: string, b: string) => a.split(".").reduce((r, n, i) => r || Math.sign(Number(n) - Number(b.split(".")[i] || 0)), 0) > 0;
    state.cli.availableVersion = newer(pkg.version, bundled.version) ? pkg.version : bundled.version;
    state.cli.updateStatus = !state.cli.compatible || newer(state.cli.availableVersion!, state.cli.version) ? "available" : "current";
  } catch (error) { state.cli.updateStatus = "error"; throw error; }
}
async function configureCliDashboard(config: any): Promise<void> {
  dashboardSession().webRequest.onBeforeSendHeaders(null);
  dashboardBearer = config?.apiToken || config?.deviceToken || null;
  if (!dashboardBearer || !installation?.compatible) { state.hasDashboard = false; state.account = null; useLocalData(); return; }
  const data = await apiRequest(state.settings.serverUrl, "/api/me", undefined, dashboardBearer, AbortSignal.timeout(8_000));
  if (!data.authenticated || !data.user?.id) throw new Error("Unable to reuse CLI sign-in");
  state.account = { id: data.user.id, name: data.user.name || null, email: data.user.email || null };
  dashboardAuthKind = data.user.auth_kind;
  state.hasDashboard = true; state.dashboardSource = "cloud"; state.notice = null;
}
async function setApiToken(value: unknown): Promise<void> {
  if (typeof value !== "string" || !value.trim()) throw new Error("Enter a read-write API token");
  if (state.loginBusy || loggingOut) throw new Error("Wait for sign-in to finish");
  changingCollector = true;
  try {
  await stopCollection();
  await cli.request("api-token", { serverUrl: state.settings.serverUrl, token: value.trim(), deviceName: state.settings.deviceName });
  await fs.rm(secretPath(), { force: true }); secret = null;
  await dashboardSession().clearStorageData(); useLocalData();
  await refreshCollector(); await configureCliDashboard((await readCollector()).config);
  watchedAuthorization = JSON.stringify([state.settings.serverUrl, value.trim(), undefined]);
  await marker(); await configureScheduler(); await showDashboard();
  if (!state.settings.paused) void runJob("sync");
  } finally { changingCollector = false; }
}
async function saveSettings(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Invalid settings");
  if (state.busy || state.loginBusy || loggingOut) throw new Error("Wait for the current operation to finish");
  const patch = value as Partial<Settings>;
  const next: Settings = { ...state.settings };
  if (patch.serverUrl !== undefined) next.serverUrl = normalizeDesktopServer(String(patch.serverUrl));
  if (patch.deviceName !== undefined) {
    next.deviceName = String(patch.deviceName).trim();
    if (!next.deviceName || next.deviceName.length > 120) throw new Error("Device name must be 1–120 characters");
  }
  for (const key of ["launchAtLogin", "paused"] as const) {
    if (patch[key] !== undefined) { if (typeof patch[key] !== "boolean") throw new Error("Invalid setting"); next[key] = patch[key]!; }
  }
  if (patch.trayMetric !== undefined) { if (!["cost", "tokens", "icon"].includes(patch.trayMetric)) throw new Error("Invalid menu bar metric"); next.trayMetric = patch.trayMetric; }
  if (patch.language !== undefined) { if (!["en", "zh"].includes(patch.language)) throw new Error("Invalid language"); next.language = patch.language; }
  if (next.serverUrl !== state.settings.serverUrl && (state.hasCollector || secret)) throw new Error("Sign out before changing the server");
  await cli.request("configure", { serverUrl: next.serverUrl, deviceName: next.deviceName, paused: next.paused });
  await atomicWrite(settingsPath(), JSON.stringify(appSettings(next), null, 2));
  state.settings = next; await refreshCollector(); state.error = null; state.notice = null;
  configureLoginItem(); await marker(); emit();
}
async function logoutDesktop(): Promise<void> {
  if (loggingOut) return;
  loggingOut = true; loginController?.abort();
  try {
    await stopCollection();
    const previous = secret;
    if (previous) {
      try { await apiRequest(previous.serverUrl, "/api/desktop/logout", { revoke_device: true }, previous.desktopToken); }
      catch (error) { if (!(error instanceof ApiError && error.status === 401)) state.notice = "Signed out locally. Server authorization could not be revoked while offline."; }
    }
    if (installation?.compatible) await cli.request("logout");
    await fs.rm(secretPath(), { force: true }); secret = null;
    await fs.rm(pendingSecretPath(), { force: true });
    await dashboardSession().clearStorageData();
    useLocalData(); dashboardSession().webRequest.onBeforeSendHeaders(null);
    dashboardBearer = null; state.account = null; state.hasDashboard = false; state.hasCollector = false; state.lastSyncAt = null;
    watchedAuthorization = JSON.stringify([state.settings.serverUrl, undefined, undefined]);
    state.error = null; await marker(); await showDashboard(); void runJob("scan");
  } finally { loggingOut = false; emit(); }
}
function runJob(action: "scan" | "sync"): Promise<void> {
  if (!installation?.compatible || collectionTask || stoppingCollection || state.loginBusy || loggingOut || shuttingDown || (action === "sync" && !state.hasCollector)) return Promise.resolve();
  collectionTask = runCollection(action).finally(() => { collectionTask = null; });
  return collectionTask;
}
async function runCollection(action: "scan" | "sync"): Promise<void> {
  state.busy = action; state.collectionPhase = "scan"; state.collectionStartedAt = new Date().toISOString();
  state.scanProgress = null; state.fetchProgress = null; state.error = null; emit();
  try {
    const data = await cli.request(action, {}, (phase) => {
      state.collectionPhase = phase; emit();
      if (phase === "pricing") void cli.request("state").then(result => { if (result.summary) { state.summary = result.summary; emit(); } }, error => { if (!stoppingCollection && !shuttingDown) { state.notice = message(error); emit(); } });
    }, progress => { state.scanProgress = progress; emit(); });
    state.summary = data.summary as LocalSummary;
    await refreshCollector(); state.notice = data.warning || null; await marker();
  } catch (error) { if (!stoppingCollection) state.error = message(error); }
  finally { state.busy = null; state.collectionPhase = null; state.collectionStartedAt = null; state.scanProgress = null; emit(); }
}
function checkSender(event: IpcMainInvokeEvent): void {
  const local = event.sender === dashboardWindow?.webContents || event.sender === settingsView?.webContents || event.sender === popup?.webContents;
  if (!local || event.senderFrame !== event.sender.mainFrame || !sameRendererLocation(event.senderFrame.url, renderer)) throw new Error("Untrusted desktop request");
}
function handle(name: string, action: (...args: any[]) => unknown): void {
  ipcMain.handle(`tokenflow:${name}`, async (event, ...args) => {
    checkSender(event);
    try { const value = await action(...args); emit(); return value; }
    catch (error) { state.error = message(error); emit(); throw new Error(state.error); }
  });
}
async function updateAction(action: unknown): Promise<void> {
  if (action === "install") {
    if (state.update.status !== "downloaded") throw new Error("Download an update first");
    shuttingDown = true; await shutdown(); autoUpdater.quitAndInstall(); return;
  }
  if (action === "download") { await autoUpdater.downloadUpdate(); return; }
  if (action !== "check") throw new Error("Invalid update action");
  if (!app.isPackaged) { state.update = { status: "current", message: "Updates are available in the installed app." }; return; }
  state.update = { status: "checking" }; emit();
  const response = await desktopFetch("https://api.github.com/repos/Renaissance-Mind/TokenFlow/releases?per_page=30", { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Update service returned ${response.status}`);
  const releases = await response.json() as Array<{ tag_name: string; draft: boolean; prerelease: boolean }>;
  const release = releases.find((item) => /^desktop-v\d+\.\d+\.\d+$/.test(item.tag_name) && !item.draft && !item.prerelease);
  if (!release) { state.update = { status: "current", message: "No desktop update has been published yet." }; return; }
  autoUpdater.setFeedURL({ provider: "generic", url: `https://github.com/Renaissance-Mind/TokenFlow/releases/download/${encodeURIComponent(release.tag_name)}/` });
  await autoUpdater.checkForUpdates();
}
async function shutdown(): Promise<void> {
  loginController?.abort(); timers.forEach(clearInterval);
  configWatcher?.close();
  await stopCollection();
  await cli?.stop();
  if (installation?.compatible) await cli.request("owner", { pid: null }).catch(() => {});
  tray?.destroy();
}
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault(); shuttingDown = true;
  void shutdown().then(() => app.quit()).catch((error) => { console.error(message(error)); app.exit(1); });
});
app.on("window-all-closed", () => {});
app.on("activate", () => { if (ready) void showDashboard(); });
app.on("second-instance", () => { if (ready) void showDashboard(); });

async function initialize(): Promise<void> {
  protocol.handle("tokenflow", (request) => {
    const url = new URL(request.url);
    const root = path.resolve(here, "../dashboard"), file = path.resolve(root, "." + decodeURIComponent(url.pathname));
    if (url.hostname !== "dashboard" || !file.startsWith(root + path.sep) || request.method !== "GET") return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(file).href);
  });
  dataHome = await collectorHome();
  await fs.mkdir(dataHome, { recursive: true });
  installation = await findCli({ fallbackNode: standaloneNode() });
  if (!installation) {
    let node = standaloneNode();
    if (!node) {
      const found = await findCli({ env: { ...process.env, TOKENFLOW_CLI_PATH: path.resolve(here, "../../dist/cli.js") } });
      node = found?.node || "";
    }
    if (!node) throw new Error("The installer did not contain its standalone Node runtime");
    installation = await installCli(runtime, node, { copyRuntime: app.isPackaged });
  }
  await selectCli(installation);
  const result = await readCollector(); let config = result.config;
  if (!config && installation.compatible) {
    await cli.request("configure", { serverUrl: normalizeDesktopServer(process.env.TOKENFLOW_SERVER_URL || state.settings.serverUrl), deviceName: state.settings.deviceName });
    config = (await readCollector()).config;
  }
  const storedSettings = await readOptional(settingsPath());
  state.settings = { ...state.settings, ...appSettings(storedSettings ? JSON.parse(storedSettings.toString()) : {}),
    ...sharedSettings(config, defaultSettings) };
  if (storedSettings) await atomicWrite(settingsPath(), JSON.stringify(appSettings(state.settings), null, 2));
  state.hasCollector = Boolean(config?.apiToken || config?.deviceToken);
  state.lastSyncAt = config?.lastSyncAt || null; state.summary = result.summary;
  watchedAuthorization = JSON.stringify([config?.serverUrl, config?.apiToken, config?.deviceToken]);
  const staged = await readOptional(pendingSecretPath());
  if (staged) {
    const pending = JSON.parse(safeStorage.decryptString(staged)) as DesktopSecret;
    if (pending.serverUrl === config?.serverUrl && pending.deviceId === config?.deviceId) await fs.rename(pendingSecretPath(), secretPath());
    else await fs.rm(pendingSecretPath(), { force: true });
  }
  const encrypted = await readOptional(secretPath());
  if (encrypted) {
    secret = JSON.parse(safeStorage.decryptString(encrypted)) as DesktopSecret;
    if (secret.serverUrl !== state.settings.serverUrl || secret.deviceId !== config?.deviceId) {
      secret = null; await fs.rm(secretPath(), { force: true });
    }
  }
  const icon = nativeImage.createFromPath(path.join(here, "../assets", process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  if (icon.isEmpty()) throw new Error("Tray icon is missing");
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on("click", togglePopup);
  tray.on("right-click", () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => void showDashboard() }, { label: "Settings", click: showSettings },
    { type: "separator" }, { label: "Quit TokenFlow", click: () => app.quit() },
  ])));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ label: "TokenFlow", submenu: [{ role: "about" as const }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: showSettings }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }] }] : []),
    { label: "File", submenu: [{ id: "dashboard", label: "Dashboard", accelerator: "CmdOrCtrl+D", click: () => void showDashboard() }, { id: "local-settings", label: "Settings", click: showSettings }, { role: "close" }] },
    { role: "editMenu" }, { label: "View", submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" },
      { id: "status-panel", label: "Status panel", accelerator: "CmdOrCtrl+Shift+T", click: togglePopup }, { role: "togglefullscreen" }] }, { role: "windowMenu" },
  ]));
  dashboardSession().setPermissionRequestHandler((_contents, permission, callback) => callback(permission === "clipboard-sanitized-write"));
  dashboardSession().webRequest.onCompleted({ urls: ["*://*/api/auth/logout"] }, (details) => {
    if (details.url === `${state.settings.serverUrl}/api/auth/logout` && details.statusCode === 200 && !loggingOut) void logoutDesktop().catch((error) => { state.error = message(error); emit(); });
  });
  handle("state", () => state); handle("login", startLogin);
  handle("cancel-login", () => { loginController?.abort(); });
  handle("settings", saveSettings); handle("sync", () => runJob("sync")); handle("scan", () => runJob("scan"));
  handle("dashboard", showDashboard); handle("dashboard-request", (value, options) => trackRequest(() => dashboardRequest(value, options)));
  handle("api-token", setApiToken); handle("cli-update", (action) => action === "check" ? checkCliUpdate() : upgradeCli()); handle("open-settings", showSettings); handle("logout", logoutDesktop);
  handle("update", async (action: unknown) => {
    try { await updateAction(action); }
    catch (error) { state.update = { status: "error", message: message(error) }; throw error; }
  });
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-available", (info) => { state.update = { status: "available", version: info.version }; emit(); });
  autoUpdater.on("update-not-available", () => { state.update = { status: "current" }; emit(); });
  autoUpdater.on("download-progress", (progress) => { state.update = { ...state.update, status: "downloading", percent: progress.percent }; emit(); });
  autoUpdater.on("update-downloaded", (info) => { state.update = { status: "downloaded", version: info.version }; emit(); });
  autoUpdater.on("error", (error) => { state.update = { status: "error", message: message(error) }; emit(); });
  configureLoginItem(); await marker(); await configureScheduler();
  timers.push(setInterval(() => { void marker().catch((error) => { state.error = message(error); emit(); }); }, 30_000));
  timers.push(setInterval(() => { if (!state.settings.paused) void runJob(state.hasCollector ? "sync" : "scan"); }, 600_000));
  powerMonitor.on("resume", () => { if (!state.settings.paused) void runJob(state.hasCollector ? "sync" : "scan"); });
  const background = process.argv.includes("--background") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);
  try { await configureCliDashboard(config); } catch (error) { state.notice = message(error); }
  ready = true; emit();
  if (!background) await showDashboard();
  if (installation.compatible) void runJob(state.hasCollector && !state.settings.paused ? "sync" : "scan");
  configWatcher = watch(dataHome, (_event, filename) => {
    if (filename === "config.json") void reconcileCollector().catch((error) => { state.notice = message(error); emit(); });
  });
  timers.push(setInterval(() => { void reconcileCollector().catch(() => {}); }, 15_000));
}
async function scheduledCollector(): Promise<void> {
  // Compatibility with launchd entries from older App versions.
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  const value = await findCli({ fallbackNode: standaloneNode() });
  if (!value?.compatible) { app.exit(0); return; }
  const client = new CliClient(value, (input, init) => net.fetch(input as string, init));
  const home = await collectorHome();
  const marker = await fs.readFile(path.join(home, "desktop-agent.json"), "utf8").catch(() => null);
  if (marker) { const owner = JSON.parse(marker); try { if (Date.now() - Date.parse(owner.updatedAt) < 120_000) { process.kill(owner.pid, 0); app.exit(0); return; } } catch {} }
  await client.request("sync"); app.exit(0);
}
void app.whenReady().then(async () => {
  setDesktopHttpClient(desktopFetch);
  if (collectorOnly) await scheduledCollector(); else await initialize();
}).catch((error) => {
  if (collectorOnly) console.error(message(error)); else dialog.showErrorBox("TokenFlow could not start", message(error));
  app.exit(1);
});
