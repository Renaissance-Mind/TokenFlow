import { _electron as electron, expect as baseExpect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const expect = baseExpect.configure({ timeout: 30_000 });
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-recovery-'));
const sourceHome = path.join(temporary, 'sources');
await fs.mkdir(sourceHome);
const env = { ...process.env, TOKENFLOW_HOME: path.join(temporary, 'collector'), TOKENFLOW_DESKTOP_DATA: path.join(temporary, 'app'), TOKENFLOW_SCAN_HOME: sourceHome, TOKENFLOW_NODE_PATH: process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME|TOKENFLOW_CLI_PATH)$/.test(key)) delete env[key];
let instance = await electron.launch({ args: [desktop], env, timeout: 60_000 });
instance.process().stderr?.on('data', data => process.stderr.write(data));
try {
  const page = await instance.firstWindow();
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#desktopLoading')).toBeHidden();
  const original = await page.evaluate(() => window.tokenflow.getState());
  const bounds = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds());
  const ready = async () => {
    await expect.poll(() => instance.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      if (!contents) return false;
      if (contents.isCrashed() || contents.isLoadingMainFrame()) return false;
      return contents.executeJavaScript(`({
        ready: document.documentElement.dataset.tokenflowReady,
        visible: document.querySelector('.desktop-toolbar').getBoundingClientRect().height > 0 && getComputedStyle(document.body).visibility === 'visible',
        loaded: document.getElementById('desktopLoading').hidden,
        cost: document.getElementById('totalCost').textContent
      })`).catch(() => false);
    })).toEqual({ ready: 'true', visible: true, loaded: true, cost: '$0.00' });
    const current = await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.tokenflow.getState()'));
    assert.equal(current.cli.path, original.cli.path);
    assert.deepEqual(current.account, original.account);
    assert.deepEqual(await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds()), bounds);
  };
  await page.evaluate(() => { window.recoveryDocument = document; });
  await page.evaluate(() => window.tokenflow.dashboard());
  assert.equal(await page.evaluate(() => window.recoveryDocument === document), true);

  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.tokenflow.openSettings()'));
  await expect.poll(() => instance.windows().some(window => window.url().includes('mode=settings'))).toBe(true);
  const settings = instance.windows().find(window => window.url().includes('mode=settings'));
  await settings.locator('[data-section=preferencesSection]').click();
  await settings.locator('#deviceName').fill('Unsaved recovery check');
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await expect(settings.locator('#deviceName')).toHaveValue('Unsaved recovery check');
  await settings.evaluate(() => window.tokenflow.dashboard());
  await ready();
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.tokenflow.openSettings()'));
  await expect(settings.locator('#deviceName')).toHaveValue('Unsaved recovery check');
  await settings.evaluate(() => window.tokenflow.dashboard());
  console.log('Hidden renderer crash recovers on reopen; Settings drafts and window bounds survive.');

  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await ready();
  console.log('Visible renderer crash recovers automatically.');

  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('document.body.style.display = "none"'));
  await instance.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('dashboard').click());
  await ready();
  console.log('A blank Dashboard recovers when reopened.');

  const logFile = path.join(env.TOKENFLOW_DESKTOP_DATA, 'dashboard-recovery.log');
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
  await expect.poll(async () => (await fs.readFile(logFile, 'utf8')).includes('Automatic recovery stopped:')).toBe(true);
  assert.equal((await fs.readFile(logFile, 'utf8')).split('Reloading Dashboard (').length - 1, 3);
  console.log('Repeated failures stop after three automatic recovery attempts.');
  await instance.close();
  instance = await electron.launch({ args: [desktop], env, timeout: 60_000 });
  instance.process().stderr?.on('data', data => process.stderr.write(data));
  await instance.firstWindow();
  await ready();
  let recoveries = (await fs.readFile(logFile, 'utf8')).split('Dashboard recovered').length - 1;
  await instance.evaluate(({ BrowserWindow }) => {
    void BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('setTimeout(() => { while (true) {} }, 0)');
  });
  await instance.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
  await expect.poll(async () => (await fs.readFile(logFile, 'utf8')).split('Dashboard recovered').length - 1).toBe(recoveries + 1);
  await ready();
  console.log('A blocked Dashboard renderer recovers on wake.');

  recoveries++;
  await instance.evaluate(async ({ BrowserWindow }) => {
    await BrowserWindow.getAllWindows()[0].loadURL('tokenflow://dashboard/missing.html').catch(() => {});
  });
  await expect.poll(async () => (await fs.readFile(logFile, 'utf8')).split('Dashboard recovered').length - 1).toBe(recoveries + 1);
  console.log('A failed main-frame load returns to the canonical Dashboard URL.');
  await ready();
} finally {
  await instance.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
