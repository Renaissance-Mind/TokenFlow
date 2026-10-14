import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-desktop-smoke-'));
const output = path.join(desktop, 'test-results'); await fs.mkdir(output, { recursive: true });
const sourceHome = path.join(temp, 'sources'); await fs.mkdir(sourceHome, { recursive: true });
const env = { ...process.env, TOKENFLOW_HOME:path.join(temp,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'),TOKENFLOW_SCAN_HOME:sourceHome,TOKENFLOW_NODE_PATH:process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME|TOKENFLOW_CLI_PATH)$/.test(key)) delete env[key];
const executablePath = process.env.TOKENFLOW_EXECUTABLE;
if (executablePath) delete env.TOKENFLOW_NODE_PATH;
const instance = await electron.launch({ args:executablePath ? [] : [desktop], ...(executablePath ? {executablePath} : {}),env,timeout:60_000 });
instance.process().stderr?.on('data',(data)=>process.stderr.write(data));
try {
  const page = await instance.firstWindow(); await page.waitForURL(/mode=dashboard$/);
  const errors = []; page.on('pageerror',(error)=>errors.push(error.message));
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#preferences')).toBeHidden(); await expect(page.locator('#loginSection')).toBeHidden();
  await expect.poll(async()=>{const s=await page.evaluate(()=>window.tokenflow.getState()); if(s.error)throw new Error(s.error); return !!s.summary&&!s.busy;},{timeout:60_000}).toBe(true);
  let state=await page.evaluate(()=>window.tokenflow.getState());
  await page.evaluate(()=>{window.dashboardIdentity=document.getElementById('app');});
  assert.equal(state.cli.source,'managed'); assert.equal(state.cli.compatible,true); assert.equal(state.hasCollector,false);
  assert.equal(state.summary.today.tokens,0); await expect(page.locator('#totalCost')).toHaveText('$0.00');
  assert.equal(await page.locator('#desktopSync').isDisabled(),true);
  await fs.access(state.cli.path); assert.ok(!state.cli.path.includes(desktop));
  await page.screenshot({path:path.join(output,'desktop-dashboard-local.png')});
  // Verify the local reading animation, with the real native state event.
  assert.equal(await page.evaluate(async()=>{
    let sawLoading=false;
    const off=window.tokenflow.onState(state=>{if(state.busy)sawLoading ||= document.querySelector('.desktop-toolbar').classList.contains('is-reading') && !document.getElementById('operationProgress').hidden && document.getElementById('progressTrack').hasAttribute('aria-valuenow');});
    await window.tokenflow.scan();off();return sawLoading;
  }),true);
  await expect.poll(async()=>!(await page.evaluate(()=>window.tokenflow.getState())).busy).toBe(true);
  await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
  await expect.poll(()=>instance.windows().some(w=>w.url().includes('mode=tray'))).toBe(true);
  const panel=instance.windows().find(w=>w.url().includes('mode=tray')); await panel.waitForLoadState('domcontentloaded');
  await expect(panel.locator('#cost')).toHaveText('$0.00'); await expect(panel.locator('#loginSection')).toBeHidden();
  await expect(panel.locator('#preferences')).toBeHidden(); await expect(panel.locator('#trayDashboard')).toBeVisible();
  await panel.screenshot({path:path.join(output,'desktop-tray.png')});
  const nativeBefore=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.webContents.getURL().includes('mode=tray')).map(w=>({id:w.id,bounds:w.getBounds()})));
  await panel.evaluate(()=>window.tokenflow.openSettings());
  await expect.poll(()=>instance.windows().some(w=>w.url().includes('mode=settings'))).toBe(true);
  const settings=instance.windows().find(w=>w.url().includes('mode=settings')); await settings.waitForLoadState('domcontentloaded');
  assert.deepEqual(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.webContents.getURL().includes('mode=tray')).map(w=>({id:w.id,bounds:w.getBounds()}))),nativeBefore);
  assert.equal(await settings.evaluate(()=>getComputedStyle(document.body).colorScheme),'light');
  settings.on('pageerror',e=>errors.push(e.message));
  await expect(settings.locator('.overview')).toBeHidden(); await expect(settings.locator('#preferences')).toBeVisible();
  await expect(settings.locator('#loginSection')).toBeVisible(); await expect(settings.locator('#apiToken')).toBeVisible();
  await expect(settings.locator('#cliPath')).toHaveText(state.cli.path);
  await settings.locator('#preferences').evaluate(form=>{
    form.querySelector('#deviceName').value='Desktop acceptance';
    form.querySelector('#language').value='zh';
    form.querySelector('#launchAtLogin').checked=false;
    form.dispatchEvent(new Event('input',{bubbles:true}));
    form.requestSubmit();
  });
  await expect.poll(async()=>(await settings.evaluate(()=>window.tokenflow.getState())).settings.deviceName).toBe('Desktop acceptance');
  await expect(settings.locator('#savedStatus')).toHaveText('设置已保存。');
  await expect(page.locator('.desktop-toolbar strong')).toHaveText('Dashboard');
  assert.equal(await page.locator('#localDashboard,#cloudDashboard').count(),0);
  await expect(settings.locator('#connectTitle')).toHaveText('账号与同步');
  await settings.screenshot({path:path.join(output,'desktop-settings.png'),fullPage:true});
  if(process.env.TOKENFLOW_SYSTEM_TEST==='1') {
    await settings.evaluate(()=>window.tokenflow.saveSettings({launchAtLogin:true}));
    assert.equal((await instance.evaluate(({app})=>app.getLoginItemSettings({args:['--background']}))).openAtLogin,true);
    await settings.evaluate(()=>window.tokenflow.saveSettings({launchAtLogin:false}));
  }
  await instance.evaluate(({BrowserWindow})=>{ const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')); win.close(); if(win.isDestroyed()||win.isVisible())throw new Error('Close must retain tray residency'); });
  await settings.evaluate(()=>window.tokenflow.dashboard());
  assert.equal(await page.evaluate(()=>window.dashboardIdentity===document.getElementById('app')),true);
  await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')).isVisible())).toBe(true);
  assert.equal(instance.windows().some(w=>/mode=(login|local)$/.test(w.url())),false);
  try{await settings.evaluate(()=>window.tokenflow.checkUpdate());}catch(error){if(!executablePath)throw error;assert.equal((await settings.evaluate(()=>window.tokenflow.getState())).update.status,'error');}
  assert.deepEqual(errors,[]);
  console.log('Desktop smoke passed: standalone CLI installation, canonical Dashboard with local data, Settings with token/login, tray, shared configuration, localization, and window close.');
} finally {
  if(process.env.TOKENFLOW_SYSTEM_TEST==='1')await instance.evaluate(({app})=>app.setLoginItemSettings({openAtLogin:false,args:['--background']})).catch(()=>{});
  await instance.close(); await fs.rm(temp,{recursive:true,force:true});
}
