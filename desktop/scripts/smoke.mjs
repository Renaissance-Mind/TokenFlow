import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-desktop-smoke-'));
const output = path.join(desktop, 'test-results');
await fs.mkdir(output, { recursive: true });
const sourceHome = path.join(temp, 'sources');
await fs.mkdir(sourceHome, { recursive: true });
const env = { ...process.env, TOKENFLOW_HOME: path.join(temp, 'collector'), TOKENFLOW_DESKTOP_DATA: path.join(temp, 'app'), TOKENFLOW_SCAN_HOME: sourceHome };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME)$/.test(key)) delete env[key];
const executablePath = process.env.TOKENFLOW_EXECUTABLE;
const instance = await electron.launch({ args: executablePath ? [] : [desktop], ...(executablePath ? { executablePath } : {}), env, timeout: 60_000 });
try {
  const page = await instance.firstWindow();
  await page.waitForURL(/\/renderer\/index.html(?:\?|$)/);
  await page.waitForLoadState('domcontentloaded');
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect.poll(async () => { const value = await page.evaluate(() => window.tokenflow.getState()); return !!value.summary && !value.busy; }, {timeout:60_000}).toBe(true);
  let state = await page.evaluate(() => window.tokenflow.getState());
  assert.equal(state.hasCollector, false);
  assert.equal(state.summary.today.tokens, 0);
  assert.ok(state.summary.sources.some((source) => source.agent === 'codex'));
  assert.ok(state.summary.sources.some((source) => source.agent === 'copilot'));
  assert.equal(await page.locator('#sync').isDisabled(), true);
  assert.equal(await page.locator('#github').isEnabled(), true);
  const trayState = await instance.evaluate(({Menu}) => {
    const item = Menu.getApplicationMenu().getMenuItemById('status-panel');
    const label = item.label;
    item.click();
    return {label};
  });
  if (process.platform === 'darwin') assert.equal(trayState.label,'Status panel · $0.00');
  await expect.poll(() => instance.windows().some((win) => win.url().includes('mode=tray'))).toBe(true);
  const panel = instance.windows().find((win) => win.url().includes('mode=tray'));
  await panel.waitForLoadState('domcontentloaded');
  await expect(panel.locator('#cost')).toHaveText('$0.00');
  await expect(panel.locator('main')).toHaveCSS('opacity','1');
  const googlePosition = await panel.locator('#google').boundingBox();
  assert.ok(googlePosition.y + googlePosition.height <= 520);
  await panel.screenshot({path:path.join(output,'desktop-tray.png')});
  await panel.evaluate(() => window.tokenflow.openSettings());
  await page.locator('#deviceName').fill('Desktop acceptance');
  await page.locator('#language').selectOption('zh');
  await page.locator('#launchAtLogin').uncheck();
  await page.locator('#preferences').evaluate((form) => form.requestSubmit());
  await expect.poll(async () => (await page.evaluate(() => window.tokenflow.getState())).settings.deviceName).toBe('Desktop acceptance');
  assert.equal(await page.locator('#connectTitle').textContent(), '一个账号，连接所有设备。');
  await page.screenshot({ path: path.join(output, 'desktop-home.png'), fullPage: true });
  await page.locator('#refresh').click();
  await expect.poll(async () => (await page.evaluate(() => window.tokenflow.getState())).busy).toBe(null);
  assert.equal(await page.locator('#error').isVisible(), false);
  if (process.env.TOKENFLOW_SYSTEM_TEST === '1') {
    await page.evaluate(() => window.tokenflow.saveSettings({launchAtLogin:true}));
    const launch = await instance.evaluate(({app}) => app.getLoginItemSettings({args:['--background']}));
    assert.equal(launch.openAtLogin,true);
    await page.evaluate(() => window.tokenflow.saveSettings({launchAtLogin:false}));
    assert.equal((await instance.evaluate(({app}) => app.getLoginItemSettings({args:['--background']}))).openAtLogin,false);
  }
  await instance.evaluate(({ BrowserWindow }) => {
    const parent = BrowserWindow.getAllWindows()[0];
    parent.close();
    if (parent.isDestroyed() || parent.isVisible()) throw new Error('Closing the window must retain background collection');
    parent.show();
  });
  try { await page.evaluate(() => window.tokenflow.checkUpdate()); }
  catch (error) {
    if (!executablePath) throw error;
    const update = (await page.evaluate(() => window.tokenflow.getState())).update;
    assert.equal(update.status,'error'); assert.ok(update.message);
    assert.equal(await page.locator('#update').isEnabled(),true);
  }
  if (!executablePath) assert.equal((await page.evaluate(() => window.tokenflow.getState())).update.status, 'current');
  assert.deepEqual(errors, []);
  console.log('Desktop smoke passed: bundled collector, local statistics, settings, language, window close, and update action.');
} finally {
  if (process.env.TOKENFLOW_SYSTEM_TEST === '1') await instance.evaluate(({app}) => app.setLoginItemSettings({openAtLogin:false,args:['--background']})).catch(() => {});
  await instance.close();
  await fs.rm(temp, { recursive: true, force: true });
}
