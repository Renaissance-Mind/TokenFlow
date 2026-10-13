import { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell, screen, session, safeStorage, utilityProcess, powerMonitor, dialog, net } from "electron";
import type { IpcMainInvokeEvent, UtilityProcess } from "electron";
import updater from "electron-updater";
import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { ApiError, apiRequest, checkedLoginUrl, createPkce, normalizeDesktopServer, setDesktopHttpClient } from "./auth.js";
import type { DesktopSecret, DesktopState, LocalSummary, Settings } from "./contracts.js";
import { sameRendererLocation } from "./ipc-origin.js";

const { autoUpdater } = updater;
const here = path.join(realpathSync.native(app.getAppPath()), "app");
const renderer = path.join(here, "../renderer/index.html");
app.setName("TokenFlow");
if (process.env.TOKENFLOW_DESKTOP_DATA) app.setPath("userData", path.resolve(process.env.TOKENFLOW_DESKTOP_DATA));
const collectorOnly = process.argv.includes("--collector-sync");
if (!collectorOnly && !app.requestSingleInstanceLock()) app.exit(0);

let localWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let dashboardLoaded = false;
let popup: BrowserWindow | null = null;
let tray: Tray;
let worker: UtilityProcess | null = null;
let workerCounter = 0;
let pendingJob: { id: number; resolve: (value: any) => void; reject: (error: Error) => void } | null = null;
let secret: DesktopSecret | null = null;
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
const loadCollector = (name: string) => import(pathToFileURL(path.join(runtime, `${name}.js`)).href);
const collectorConfig = async () => await loadCollector("config") as typeof import("../../dist/config.js");
const state: DesktopState = {
  version: app.getVersion(), collectorVersion: "", settings: {
    serverUrl: "https://tokenflow.renaissancemind.ai", deviceName: os.hostname(), launchAtLogin: true,
    paused: false, trayMetric: "cost", language: app.getLocale().startsWith("zh") ? "zh" : "en",
  }, account: null, hasCollector: false, hasDashboard: false, busy: null, lastSyncAt: null,
  summary: null, login: null, error: null, notice: null, update: { status: "idle" },
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
  for (const win of [localWindow, popup]) if (win && !win.isDestroyed()) win.webContents.send("tokenflow:changed", state);
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
function protectLocalWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
function localPreferences() {
  return { preload: path.join(here, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };
}
function showLocal(): void {
  if (popup?.isVisible()) popup.hide();
  if (!localWindow || localWindow.isDestroyed()) {
    localWindow = new BrowserWindow({ width: 1000, height: 830, minWidth: 760, minHeight: 640,
      title: "TokenFlow", backgroundColor: "#0b0e15", show: false, autoHideMenuBar: true, webPreferences: localPreferences() });
    protectLocalWindow(localWindow);
    localWindow.on("close", (event) => { if (!shuttingDown) { event.preventDefault(); localWindow!.hide(); } });
    localWindow.once("ready-to-show", () => localWindow?.show());
    void localWindow.loadFile(renderer);
  } else localWindow.show();
  localWindow.focus();
}
function togglePopup(): void {
  if (popup?.isVisible()) { popup.hide(); return; }
  if (!popup || popup.isDestroyed()) {
    popup = new BrowserWindow({ width: 380, height: 520, frame: false, resizable: false, show: false,
      skipTaskbar: true, alwaysOnTop: true, backgroundColor: "#0b0e15", webPreferences: localPreferences() });
    protectLocalWindow(popup);
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
async function showDashboard(): Promise<void> {
  if (!state.hasDashboard) { showLocal(); return; }
  popup?.hide();
  localWindow?.hide();
  if (!dashboardWindow || dashboardWindow.isDestroyed()) {
    dashboardWindow = new BrowserWindow({ width: 1440, height: 960, minWidth: 800, minHeight: 640,
      title: "TokenFlow Dashboard", backgroundColor: "#0b0e15", show: false, autoHideMenuBar: true,
      webPreferences: { session: dashboardSession(), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
    const contents = dashboardWindow.webContents;
    contents.setWindowOpenHandler(({ url }) => {
      if (allowedWebUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      const target = new URL(url);
      if (target.origin === state.settings.serverUrl && !target.pathname.startsWith("/auth/") && target.pathname !== "/") return;
      event.preventDefault();
      if (target.origin === state.settings.serverUrl) showLocal();
      else if (allowedWebUrl(url)) void shell.openExternal(url);
    });
    contents.on("did-fail-load", (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      dashboardLoaded = false; state.error = `Dashboard connection failed: ${description}`; dashboardWindow?.hide(); showLocal(); emit();
    });
    dashboardWindow.on("close", (event) => { if (!shuttingDown) { event.preventDefault(); dashboardWindow!.hide(); } });
    dashboardWindow.once("ready-to-show", () => dashboardWindow?.show());
  }
  if (!dashboardLoaded) {
    await dashboardWindow.loadURL(`${state.settings.serverUrl}/dashboard`);
    dashboardLoaded = true;
  }
  dashboardWindow.show(); dashboardWindow.focus();
}
async function setDashboardSession(token: string, expiresAt: string): Promise<void> {
  if (!token.startsWith("tu_sess_") || !Number.isFinite(Date.parse(expiresAt))) throw new Error("Server returned an invalid dashboard session");
  await dashboardSession().cookies.set({ url: state.settings.serverUrl, name: "tu_session", value: token,
    path: "/", httpOnly: true, secure: state.settings.serverUrl.startsWith("https:"), sameSite: "lax", expirationDate: Date.parse(expiresAt) / 1000 });
  await dashboardSession().cookies.flushStore();
  const response = await dashboardSession().fetch(`${state.settings.serverUrl}/api/me`, { credentials: "include", redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new ApiError("Dashboard authorization failed", response.status);
  const data = await response.json() as any;
  if (!data.user?.id) throw new Error("Dashboard did not return an account");
  state.account = { id: data.user.id, name: data.user.name || null, email: data.user.email || null };
  state.hasDashboard = true;
}
async function restoreSession(openDashboard = false): Promise<void> {
  if (!secret || loggingOut) return;
  try {
    const result = await apiRequest(secret.serverUrl, "/api/desktop/session", {}, secret.desktopToken);
    await setDashboardSession(result.session_token, result.session_expires_at);
    if (openDashboard) await showDashboard();
    emit();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.hasDashboard = false; state.account = null;
      state.error = error.message;
    } else state.error = `Unable to restore dashboard: ${message(error)}`;
    emit();
  }
}
async function marker(): Promise<void> {
  const config = await collectorConfig();
  const file = path.join(config.tokenUsageDir(), "desktop-agent.json");
  if (state.hasCollector) await atomicWrite(file, JSON.stringify({ pid: process.pid, updatedAt: new Date().toISOString() }));
  else await fs.rm(file, { force: true });
}
async function waitForJob(): Promise<void> { while (pendingJob) await delay(100); }
async function mutateCollector(action: (config: Awaited<ReturnType<typeof collectorConfig>>) => Promise<void>): Promise<void> {
  await waitForJob();
  const { acquireSyncLock } = await loadCollector("collector") as typeof import("../../dist/collector.js");
  const release = await acquireSyncLock();
  if (!release) throw new Error("The CLI is syncing. Wait for it to finish and try again.");
  try { await action(await collectorConfig()); } finally { await release(); }
}
async function startLogin(provider: unknown): Promise<void> {
  if (provider !== "github" && provider !== "google") throw new Error("Choose GitHub or Google");
  if (state.busy || loggingOut) throw new Error("Wait for the current operation to finish");
  const controller = new AbortController(); loginController = controller;
  state.busy = "login"; state.error = null; emit();
  try {
    const pkce = createPkce();
    const config = await (await collectorConfig()).readConfig();
    const existing = config?.serverUrl === state.settings.serverUrl ? config.deviceToken : undefined;
    const start = await apiRequest(state.settings.serverUrl, "/api/desktop/start", {
      provider, code_challenge: pkce.challenge, device_name: state.settings.deviceName, platform: process.platform,
    }, existing, controller.signal);
    if (typeof start.code !== "string" || typeof start.user_code !== "string" || !Number.isFinite(Date.parse(start.expires_at))) throw new Error("Server returned an invalid login request");
    state.login = { code: start.user_code, expiresAt: start.expires_at }; emit();
    await shell.openExternal(checkedLoginUrl(start.login_url, state.settings.serverUrl, provider));
    void pollLogin(start, pkce.verifier, existing, controller);
  } catch (error) {
    if (loginController === controller) { state.busy = null; state.login = null; loginController = null; }
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
      await mutateCollector(async ({ readConfig, writeConfig, tokenUsageDir }) => {
        const current = await readConfig();
        if (current?.serverUrl !== state.settings.serverUrl || (current.apiToken || current.deviceToken) !== token) {
          await fs.rm(path.join(tokenUsageDir(), "sync-state.json"), { force: true });
        }
        await writeConfig({ ...current, apiToken: undefined, serverUrl: state.settings.serverUrl, deviceToken: token,
          deviceId: result.device_id, deviceName: state.settings.deviceName, installedAt: current?.installedAt || new Date().toISOString() });
        await fs.rename(pendingSecretPath(), secretPath());
        secret = nextSecret;
      });
      await setDashboardSession(result.session_token, result.session_expires_at);
      state.hasCollector = true; state.notice = null;
      await marker(); configureLoginItem(); await configureBundledCollector();
      await showDashboard();
      return;
    }
    throw new Error("Login expired. Sign in again.");
  } catch (error) { if (!controller.signal.aborted) state.error = message(error); }
  finally {
    if (loginController === controller) {
      loginController = null; state.login = null; state.busy = null; emit();
      if (state.hasCollector && state.hasDashboard && !state.settings.paused) void runJob("sync");
    }
  }
}
function configureLoginItem(): void {
  if (app.isPackaged && (!process.env.TOKENFLOW_DESKTOP_DATA || process.env.TOKENFLOW_SYSTEM_TEST === "1") && ["darwin", "win32"].includes(process.platform)) {
    app.setLoginItemSettings({ openAtLogin: state.settings.launchAtLogin, args: ["--background"] });
  }
}
async function configureBundledCollector(): Promise<void> {
  if (!app.isPackaged || process.env.TOKENFLOW_DESKTOP_DATA) return;
  const { tokenUsageDir } = await collectorConfig();
  const bin = path.join(tokenUsageDir(), "bin"); await fs.mkdir(bin, { recursive: true });
  const cli = path.join(runtime, "desktop-cli.mjs");
  if (process.platform === "darwin") {
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const command = `TOKENFLOW_HOME=${quote(tokenUsageDir())} ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(cli)}`;
    const launcher = path.join(bin, "tokenflow");
    await atomicWrite(launcher, `#!/bin/sh\n${command} "$@"\n`); await fs.chmod(launcher, 0o755);
    if (state.hasCollector) {
      const { installAutoSync } = await loadCollector("scheduler") as typeof import("../../dist/scheduler.js");
      await installAutoSync(state.settings.serverUrl, os.homedir(), {
        env: { ...process.env, TOKENFLOW_AUTO_SYNC_COMMAND: `TOKENFLOW_HOME=${quote(tokenUsageDir())} ${quote(process.execPath)} --collector-sync` },
      });
    }
  } else if (process.platform === "win32") {
    await atomicWrite(path.join(bin, "tokenflow.cmd"), `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${cli}" %*\r\n`);
  }
}
async function saveSettings(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") throw new Error("Invalid settings");
  if (state.busy || loggingOut) throw new Error("Wait for the current operation to finish");
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
  await mutateCollector(async ({ readConfig, writeConfig }) => {
    const config = await readConfig();
    if (config?.deviceToken && next.deviceName !== state.settings.deviceName) {
      const { renameDevice } = await loadCollector("api") as typeof import("../../dist/api.js");
      await renameDevice(next.serverUrl, config.deviceToken, next.deviceName);
    }
    await writeConfig({ ...config, serverUrl: next.serverUrl, deviceName: next.deviceName,
      installedAt: config?.installedAt || new Date().toISOString() });
  });
  await atomicWrite(settingsPath(), JSON.stringify(next, null, 2));
  state.settings = next; state.error = null; state.notice = null;
  configureLoginItem(); await marker(); emit();
}
async function logoutDesktop(): Promise<void> {
  if (loggingOut) return;
  loggingOut = true; loginController?.abort();
  try {
    await waitForJob();
    const previous = secret;
    if (previous) {
      try { await apiRequest(previous.serverUrl, "/api/desktop/logout", { revoke_device: true }, previous.desktopToken); }
      catch (error) { if (!(error instanceof ApiError && error.status === 401)) state.notice = "Signed out locally. Server authorization could not be revoked while offline."; }
    }
    await mutateCollector(async ({ readConfig, writeConfig, tokenUsageDir }) => {
      const config = await readConfig();
      if (config && config.serverUrl === state.settings.serverUrl) {
        const { deviceToken, apiToken, deviceId, ...rest } = config;
        await writeConfig(rest);
        await fs.rm(path.join(tokenUsageDir(), "sync-state.json"), { force: true });
      }
    });
    await fs.rm(secretPath(), { force: true }); secret = null;
    await fs.rm(pendingSecretPath(), { force: true });
    await dashboardSession().clearStorageData();
    dashboardWindow?.destroy(); dashboardWindow = null; dashboardLoaded = false;
    state.account = null; state.hasDashboard = false; state.hasCollector = false; state.lastSyncAt = null;
    state.error = null; await marker(); showLocal();
  } finally { loggingOut = false; emit(); }
}
async function ensureWorker(): Promise<void> {
  if (worker) return;
  worker = utilityProcess.fork(path.join(here, "collector-worker.js"), [], {
    serviceName: "TokenFlow Collector", stdio: "pipe", env: { ...process.env, TOKENFLOW_COLLECTOR_PATH: runtime },
  });
  const proc = worker;
  proc.stdout?.on("data", () => {});
  proc.stderr?.on("data", (data) => { const line = String(data); if (!line.includes("ExperimentalWarning")) process.stderr.write(line); });
  proc.on("exit", (code) => {
    if (worker === proc) worker = null;
    if (pendingJob) { pendingJob.reject(new Error(`Collector exited (${code})`)); pendingJob = null; }
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { proc.kill(); reject(new Error("Collector did not start")); }, 30_000);
    proc.on("message", (data: any) => {
      if (data.ready) { clearTimeout(timer); resolve(); return; }
      if (pendingJob && data.id === pendingJob.id) {
        const job = pendingJob; pendingJob = null;
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data);
      }
    });
    proc.once("exit", () => { clearTimeout(timer); reject(new Error("Collector could not start")); });
  });
}
async function runJob(action: "scan" | "sync"): Promise<void> {
  if (state.busy || loggingOut || shuttingDown || (action === "sync" && !state.hasCollector)) return;
  state.busy = action; state.error = null; emit();
  try {
    await ensureWorker();
    const data = await new Promise<any>((resolve, reject) => {
      pendingJob = { id: ++workerCounter, resolve, reject }; worker!.postMessage({ id: workerCounter, action });
    });
    state.summary = data.summary as LocalSummary;
    const config = await (await collectorConfig()).readConfig();
    state.hasCollector = Boolean(config?.apiToken || config?.deviceToken);
    state.lastSyncAt = config?.lastSyncAt || null;
    state.notice = data.warning || null;
    await marker();
  } catch (error) { state.error = message(error); }
  finally { state.busy = null; emit(); }
}
function checkSender(event: IpcMainInvokeEvent): void {
  const local = event.sender === localWindow?.webContents || event.sender === popup?.webContents;
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
  const response = await net.fetch("https://api.github.com/repos/Renaissance-Mind/TokenFlow/releases?per_page=30", { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Update service returned ${response.status}`);
  const releases = await response.json() as Array<{ tag_name: string; draft: boolean; prerelease: boolean }>;
  const release = releases.find((item) => /^desktop-v\d+\.\d+\.\d+$/.test(item.tag_name) && !item.draft && !item.prerelease);
  if (!release) { state.update = { status: "current", message: "No desktop update has been published yet." }; return; }
  autoUpdater.setFeedURL({ provider: "generic", url: `https://github.com/Renaissance-Mind/TokenFlow/releases/download/${encodeURIComponent(release.tag_name)}/` });
  await autoUpdater.checkForUpdates();
}
async function shutdown(): Promise<void> {
  loginController?.abort(); timers.forEach(clearInterval);
  await waitForJob();
  const { tokenUsageDir } = await collectorConfig();
  await fs.rm(path.join(tokenUsageDir(), "desktop-agent.json"), { force: true });
  worker?.kill(); tray?.destroy();
}
app.on("before-quit", (event) => {
  if (shuttingDown) return;
  event.preventDefault(); shuttingDown = true;
  void shutdown().then(() => app.quit()).catch((error) => { console.error(message(error)); app.exit(1); });
});
app.on("window-all-closed", () => {});
app.on("activate", () => { if (ready) void (state.hasDashboard ? showDashboard() : showLocal()); });
app.on("second-instance", () => { if (ready) void (state.hasDashboard ? showDashboard() : showLocal()); });

async function initialize(): Promise<void> {
  const { readConfig, tokenUsageDir } = await collectorConfig();
  const config = await readConfig();
  state.collectorVersion = (JSON.parse(await fs.readFile(path.join(runtime, "package.json"), "utf8")) as { version: string }).version;
  const storedSettings = await readOptional(settingsPath());
  state.settings = { ...state.settings, serverUrl: normalizeDesktopServer(config?.serverUrl || process.env.TOKENFLOW_SERVER_URL || state.settings.serverUrl),
    deviceName: config?.deviceName || state.settings.deviceName, ...(storedSettings ? JSON.parse(storedSettings.toString()) : {}) };
  state.settings.serverUrl = normalizeDesktopServer(state.settings.serverUrl);
  state.hasCollector = Boolean(config?.apiToken || config?.deviceToken);
  state.lastSyncAt = config?.lastSyncAt || null;
  const cache = await readOptional(path.join(tokenUsageDir(), "desktop-summary.json"));
  if (cache) state.summary = JSON.parse(cache.toString());
  const staged = await readOptional(pendingSecretPath());
  if (staged) {
    const pending = JSON.parse(safeStorage.decryptString(staged)) as DesktopSecret;
    if (pending.serverUrl === config?.serverUrl && pending.deviceId === config?.deviceId) await fs.rename(pendingSecretPath(), secretPath());
    else await fs.rm(pendingSecretPath(), { force: true });
  }
  const encrypted = await readOptional(secretPath());
  if (encrypted) {
    secret = JSON.parse(safeStorage.decryptString(encrypted)) as DesktopSecret;
    if (secret.serverUrl !== state.settings.serverUrl) throw new Error("Stored desktop authorization belongs to another server");
  }
  const icon = nativeImage.createFromPath(path.join(here, "../assets", process.platform === "darwin" ? "trayTemplate.png" : "tray.png"));
  if (icon.isEmpty()) throw new Error("Tray icon is missing");
  if (process.platform === "darwin") icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.on("click", togglePopup);
  tray.on("right-click", () => tray.popUpContextMenu(Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => void showDashboard() }, { label: "Settings", click: showLocal },
    { type: "separator" }, { label: "Quit TokenFlow", click: () => app.quit() },
  ])));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{ label: "TokenFlow", submenu: [{ role: "about" as const }, { label: "Settings…", accelerator: "CmdOrCtrl+,", click: showLocal }, { type: "separator" as const }, { role: "hide" as const }, { role: "hideOthers" as const }, { role: "unhide" as const }, { type: "separator" as const }, { role: "quit" as const }] }] : []),
    { label: "File", submenu: [{ label: "Dashboard", accelerator: "CmdOrCtrl+D", click: () => void showDashboard() }, { label: "Settings", click: showLocal }, { role: "close" }] },
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
  handle("dashboard", showDashboard); handle("open-settings", showLocal); handle("logout", logoutDesktop);
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
  configureLoginItem(); await marker(); await configureBundledCollector();
  timers.push(setInterval(() => { void marker().catch((error) => { state.error = message(error); emit(); }); }, 30_000));
  timers.push(setInterval(() => { if (!state.settings.paused) void runJob(state.hasCollector ? "sync" : "scan"); }, 600_000));
  timers.push(setInterval(() => { void restoreSession(); }, 24 * 60 * 60 * 1000));
  powerMonitor.on("resume", () => { if (!state.settings.paused) void runJob(state.hasCollector ? "sync" : "scan"); });
  ready = true; emit();
  const background = process.argv.includes("--background") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAtLogin);
  if (!background) showLocal();
  void restoreSession(!background);
  void runJob(state.hasCollector && !state.settings.paused ? "sync" : "scan");
}
async function scheduledCollector(): Promise<void> {
  if (process.platform === "darwin") app.setActivationPolicy("prohibited");
  const { desktopAgentIsRunning } = await loadCollector("collector") as typeof import("../../dist/collector.js");
  if (await desktopAgentIsRunning()) { app.exit(0); return; }
  await ensureWorker();
  await new Promise<void>((resolve, reject) => {
    pendingJob = { id: ++workerCounter, resolve: () => resolve(), reject };
    worker!.postMessage({ id: workerCounter, action: "sync" });
  });
  worker?.kill(); app.exit(0);
}
void app.whenReady().then(async () => {
  setDesktopHttpClient((input, init) => net.fetch(input as string, init));
  if (collectorOnly) await scheduledCollector(); else await initialize();
}).catch((error) => {
  if (collectorOnly) console.error(message(error)); else dialog.showErrorBox("TokenFlow could not start", message(error));
  app.exit(1);
});
