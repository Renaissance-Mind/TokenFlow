import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trayAnchor, trayPopupBounds } from '../app/tray-placement.js';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-desktop-smoke-'));
const output = path.join(desktop, 'test-results'); await fs.mkdir(output, { recursive: true });
const sourceHome = path.join(temp, 'sources'); await fs.mkdir(sourceHome, { recursive: true });
const env = { ...process.env, TOKENFLOW_HOME:path.join(temp,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'),TOKENFLOW_SCAN_HOME:sourceHome,TOKENFLOW_NODE_PATH:process.execPath };
delete env.ELECTRON_RUN_AS_NODE;
for (const key of Object.keys(env)) if (/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME|TOKENFLOW_CLI_PATH)$/.test(key)) delete env[key];
const executablePath = process.env.TOKENFLOW_EXECUTABLE;
if (executablePath) delete env.TOKENFLOW_NODE_PATH;
const positionTest=process.platform==='darwin'&&!executablePath;
const bootstrap=path.join(temp,'tray-test.cjs');
if(positionTest) await fs.writeFile(bootstrap,`const {Tray}=require('electron');
const on=Tray.prototype.on;
Tray.prototype.on=function(event,...listeners){if(event==='click')globalThis.trayPositionTest=this;return on.call(this,event,...listeners);};
`);
const instance = await electron.launch({ args:executablePath ? [] : [...(positionTest?['-r',bootstrap]:[]),desktop], ...(executablePath ? {executablePath} : {}),env,timeout:60_000 });
instance.process().stderr?.on('data',(data)=>process.stderr.write(data));
try {
  const page = await instance.firstWindow(); await page.waitForURL(/mode=dashboard$/);
  const errors = []; page.on('pageerror',(error)=>errors.push(error.message));
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#preferences')).toBeHidden(); await expect(page.locator('#loginSection')).toBeHidden();
  await expect.poll(async()=>{const s=await page.evaluate(()=>window.tokenflow.getState()); if(s.error)throw new Error(s.error); return !!s.summary&&!s.busy;},{timeout:60_000}).toBe(true);
  let state=await page.evaluate(()=>window.tokenflow.getState());
  if(process.platform==='darwin') {
    const frame=await instance.evaluate(({BrowserWindow})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard'));
      return {bounds:win.getBounds(),content:win.getContentBounds(),buttons:win.getWindowButtonPosition()};
    });
    assert.equal(frame.bounds.height,frame.content.height);
    assert.deepEqual(frame.buttons,{x:18,y:21});
  }
  await page.evaluate(()=>{window.dashboardIdentity=document.getElementById('app');});
  assert.equal(state.cli.source,'managed'); assert.equal(state.cli.compatible,true); assert.equal(state.hasCollector,false);
  assert.equal(state.summary.today.tokens,0); await expect(page.locator('#totalCost')).toHaveText('$0.00');
  assert.equal(await page.locator('#desktopSync').isDisabled(),true);
  await fs.access(state.cli.path); assert.ok(!state.cli.path.includes(desktop));
  // The redesigned web layout and its fonts/charts are fully bundled. Exercise
  // the real local CLI adapter while outgoing renderer requests are rejected.
  const failedAssets=[];page.on('requestfailed',request=>failedAssets.push(request.url()));
  const externalRequests=[];await page.route(/^https?:/,route=>{externalRequests.push(route.request().url());return route.abort();});
  await page.reload();await expect(page.locator('#app')).toBeVisible();
  await page.evaluate(()=>{window.dashboardIdentity=document.getElementById('app');});
  assert.equal(await page.evaluate(()=>echarts.version),'6.1.0');
  assert.equal(await page.evaluate(async()=>{await document.fonts.ready;return document.fonts.check('500 14px Inter');}),true);
  for(const width of [1440,1000,800]) {
    await page.setViewportSize({width,height:900});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect.poll(()=>page.evaluate(()=>{
      const sidebar=document.querySelector('.tbti-sidebar').getBoundingClientRect();
      const toolbar=document.querySelector('.desktop-toolbar').getBoundingClientRect();
      return {clear:sidebar.top>=toolbar.bottom-1,sidebar:sidebar.top,toolbar:toolbar.bottom,width:innerWidth};
    }).then(value=>value.clear?true:value)).toBe(true);
    // Real CLI scan events exercise the compact progress at every window size.
    const layout=await page.evaluate(async()=>{
      const header=document.querySelector('.desktop-toolbar');
      const before=header.getBoundingClientRect().height;const samples=[];
      const off=window.tokenflow.onState(state=>{if(state.busy){
        const bar=document.getElementById('operationProgress').getBoundingClientRect(),track=document.getElementById('progressTrack').getBoundingClientRect(),toolbar=header.getBoundingClientRect();
        samples.push({height:toolbar.height,sameRow:bar.top>=toolbar.top&&bar.bottom<=toolbar.bottom,track:track.width,buttons:Array.from(document.querySelectorAll('.desktop-actions button')).every(button=>{const r=button.getBoundingClientRect();return r.top>=toolbar.top&&r.bottom<=toolbar.bottom&&r.right<=innerWidth;}),label:document.getElementById('progressLabel').textContent});
      }});
      await window.tokenflow.scan();off();return {before,after:header.getBoundingClientRect().height,samples};
    });
    assert.equal(layout.before,56);assert.equal(layout.after,56);assert.ok(layout.samples.length);
    for(const sample of layout.samples){assert.equal(sample.height,56);assert.equal(sample.sameRow,true);assert.ok(sample.track<=76);assert.equal(sample.buttons,true);assert.match(sample.label,/files/);}
  }
  await page.setViewportSize({width:1440,height:960});
  await page.locator('#dashboardRange7').click();await expect(page.locator('#dashboardRange7')).toHaveAttribute('aria-pressed','true');
  await page.locator('[data-picker="deviceFilter"] .picker-trigger').click();
  await expect(page.locator('#deviceFilterMenu')).toBeVisible();await page.keyboard.press('Escape');
  await page.locator('#themeToggle').click();
  const theme=await page.locator('html').getAttribute('data-theme');assert.ok(['light','dark'].includes(theme));
  await page.locator('#themeToggle').click();
  assert.equal(await page.locator('.tbti-sidebar').evaluate(sidebar=>sidebar.scrollLeft),0);
  if(process.platform==='darwin'&&process.env.TOKENFLOW_WINDOW_CHROME_TEST==='1') {
    await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')).setFullScreen(true));
    await expect(page.locator('html')).toHaveAttribute('data-full-screen','true');
    assert.equal(await page.locator('.desktop-toolbar').evaluate(el=>getComputedStyle(el).paddingLeft),'24px');
    await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')).setFullScreen(false));
    await expect(page.locator('html')).toHaveAttribute('data-full-screen','false');
    assert.equal(await page.locator('.desktop-toolbar').evaluate(el=>getComputedStyle(el).paddingLeft),'104px');
  }
  assert.deepEqual(externalRequests,[]);assert.deepEqual(failedAssets,[]);
  await page.screenshot({path:path.join(output,'desktop-dashboard-local.png')});
  // Verify the local reading animation, with the real native state event.
  assert.equal(await page.evaluate(async()=>{
    let sawLoading=false,sidebarClear=true;
    const off=window.tokenflow.onState(state=>{if(state.busy){
      sawLoading ||= document.querySelector('.desktop-toolbar').classList.contains('is-reading') && !document.getElementById('operationProgress').hidden && document.getElementById('progressTrack').hasAttribute('aria-valuenow');
      sidebarClear &&= document.querySelector('.tbti-sidebar').getBoundingClientRect().top>=document.querySelector('.desktop-toolbar').getBoundingClientRect().bottom-1;
    }});
    await window.tokenflow.scan();off();return sawLoading&&sidebarClear;
  }),true);
  await expect.poll(async()=>!(await page.evaluate(()=>window.tokenflow.getState())).busy).toBe(true);
  if(process.platform==='darwin'&&process.env.TOKENFLOW_WINDOW_CHROME_TEST==='1') {
    // First creation while the main window is already full-screen must still
    // produce a small auxiliary panel rather than another full-screen window.
    await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')).setFullScreen(true));
    await expect(page.locator('html')).toHaveAttribute('data-full-screen','true');
  }
  const dockBeforePopup=process.platform==='darwin' ? await instance.evaluate(({app})=>app.dock.isVisible()) : null;
  await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
  await expect.poll(()=>instance.windows().some(w=>w.url().includes('mode=tray'))).toBe(true);
  const panel=instance.windows().find(w=>w.url().includes('mode=tray')); await panel.waitForLoadState('domcontentloaded');
  panel.on('pageerror',error=>errors.push(error.message));
  await expect(panel.locator('body')).toHaveAttribute('data-mini-loaded','true');
  await expect(panel.locator('#totalCost')).toHaveText('$0.00');
  await expect(panel.locator('#miniArchive')).toBeHidden();await expect(panel.locator('#trayDashboard')).toBeVisible();
  await expect(panel.locator('#miniSource')).toHaveText('This device');
  for(const name of ['overview','trend','models'])await expect(panel.locator('[data-mini-widget="'+name+'"]')).toBeVisible();
  await expect(panel.locator('[data-mini-widget="activity"]')).toBeHidden();
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.platform==='darwin') {
    const nativePanel=await instance.evaluate(({BrowserWindow,app})=>{
      const win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray'));
      return {allSpaces:win.isVisibleOnAllWorkspaces(),dock:app.dock.isVisible(),fullscreen:win.isFullScreen(),fullscreenable:win.isFullScreenable(),bounds:win.getBounds()};
    });
    assert.equal(nativePanel.allSpaces,true);assert.equal(nativePanel.dock,dockBeforePopup);
    assert.equal(nativePanel.fullscreen,false);assert.equal(nativePanel.fullscreenable,false);
    assert.equal(nativePanel.bounds.width,420);assert.ok(nativePanel.bounds.height<=760);
    if(process.env.TOKENFLOW_WINDOW_CHROME_TEST==='1') {
      console.log('Tray first-open in full-screen passed:',nativePanel.bounds);
      await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')).setFullScreen(false));
      await expect(page.locator('html')).toHaveAttribute('data-full-screen','false');
      if(!await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).isVisible())) {
        await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
      }
    }
    // A panel activation must not resurrect a hidden Dashboard on another Space.
    assert.deepEqual(await instance.evaluate(({BrowserWindow,app})=>{
      const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard'));
      const popup=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray'));
      main.hide();app.emit('activate',{},true);
      return {mainVisible:main.isVisible(),popupVisible:popup.isVisible()};
    }),{mainVisible:false,popupVisible:true});
    if(process.env.TOKENFLOW_WINDOW_CHROME_TEST==='1') {
      await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}));
      await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).isVisible())).toBe(false);
      // Use a separate native full-screen window so the Dashboard stays on its
      // original desktop, just as when another application owns the full-screen Space.
      await instance.evaluate(async({BrowserWindow,app})=>{
        const fixture=new BrowserWindow({width:900,height:700,title:'TokenFlow full-screen compatibility test',backgroundColor:'#163b4b'});
        await fixture.loadURL('data:text/html,<body style="background:%23163b4b;color:white;font:36px system-ui;padding:60px">Full-screen compatibility test</body>');
        await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Fixture did not enter full-screen')),15_000);fixture.once('enter-full-screen',()=>{clearTimeout(timeout);resolve();});fixture.setFullScreen(true);});
        globalThis.traySpaceTest={fixtureId:fixture.id,activations:0,dashboardFocus:0};
        app.on('activate',()=>globalThis.traySpaceTest.activations++);
        BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard')).on('focus',()=>globalThis.traySpaceTest.dashboardFocus++);
      });
      for(let attempt=0;attempt<2;attempt++) {
        await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
        await expect.poll(()=>instance.evaluate(({BrowserWindow})=>{
          const proof=globalThis.traySpaceTest;
          const fixture=BrowserWindow.fromId(proof.fixtureId);
          const popup=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray'));
          const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=dashboard'));
          return {fullscreen:fixture.isFullScreen(),mainVisible:main.isVisible(),popupVisible:popup.isVisible(),popupFocused:popup.isFocused(),activations:proof.activations,dashboardFocus:proof.dashboardFocus};
        })).toEqual({fullscreen:true,mainVisible:false,popupVisible:true,popupFocused:true,activations:0,dashboardFocus:0});
        await panel.locator('[data-mini-range="30"]').click();
        await expect(panel.locator('[data-mini-range="30"]')).toHaveAttribute('aria-pressed','true');
        await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}));
        await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).isVisible())).toBe(false);
      }
      await instance.evaluate(async({BrowserWindow})=>{
        const fixture=BrowserWindow.fromId(globalThis.traySpaceTest.fixtureId);
        await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Fixture did not leave full-screen')),15_000);fixture.once('leave-full-screen',()=>{clearTimeout(timeout);resolve();});fixture.setFullScreen(false);});fixture.destroy();
      });
      await page.evaluate(()=>window.tokenflow.saveSettings({trayRange:7}));
      console.log('Native tray Spaces regression passed: separate full-screen window retained, no App activation or Dashboard focus, interactive popup, Escape close, repeat open, Dock retained.');
    }
    await page.evaluate(()=>window.tokenflow.dashboard());
    await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
    await expect.poll(()=>instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).isVisible())).toBe(true);
  }
  if(positionTest) {
    assert.equal(await instance.evaluate(()=>!!globalThis.trayPositionTest),true);
    const displays=await instance.evaluate(({screen})=>screen.getAllDisplays().map(d=>({id:d.id,bounds:d.bounds,workArea:d.workArea})));
    const results=[];
    for(const display of displays) {
      const cursor={x:display.bounds.x+Math.round(display.bounds.width*0.7),y:display.bounds.y+12};
      const icon={x:cursor.x-20,y:display.bounds.y,width:60,height:Math.max(24,display.workArea.y-display.bounds.y)};
      await instance.evaluate(({BrowserWindow,screen},{cursor,icon})=>{
        BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).hide();
        const original=screen.getCursorScreenPoint;
        screen.getCursorScreenPoint=()=>({...cursor});
        try {
          // Exercise the actual production Tray listener with the erroneous
          // window-local point returned by Electron on macOS. Only the OS
          // cursor read is controlled; real display layout and windows are used.
          globalThis.trayPositionTest.emit('click',{},icon,{x:15,y:screen.getPrimaryDisplay().bounds.height-12});
        } finally { screen.getCursorScreenPoint=original; }
      },{cursor,icon});
      await expect.poll(()=>instance.evaluate(({BrowserWindow,screen})=>{
        const popup=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray'));
        return popup.isVisible()&&screen.getDisplayMatching(popup.getBounds()).id;
      })).toBe(display.id);
      const bounds=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).getBounds());
      assert.deepEqual(bounds,trayPopupBounds(trayAnchor(icon,cursor,display.bounds),display.workArea,bounds.height));
      await panel.evaluate(()=>window.tokenflow.resizeTray(600));
      const resized=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=tray')).getBounds());
      assert.deepEqual(resized,trayPopupBounds(trayAnchor(icon,cursor,display.bounds),display.workArea,resized.height));
      results.push({display:display.id,cursor,bounds,resized});
    }
    await fs.writeFile(path.join(output,'desktop-tray-position.json'),JSON.stringify(results,null,2));
    console.log('Native tray click positioning passed on '+displays.length+' connected display(s):',results);
  }
  await panel.screenshot({path:path.join(output,'desktop-tray.png')});
  const nativeBefore=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.webContents.getURL().includes('mode=tray')).map(w=>({id:w.id,bounds:w.getBounds()})));
  await panel.evaluate(()=>window.tokenflow.openSettings());
  await expect.poll(()=>instance.windows().some(w=>w.url().includes('mode=settings'))).toBe(true);
  const settings=instance.windows().find(w=>w.url().includes('mode=settings')); await settings.waitForLoadState('domcontentloaded');
  assert.deepEqual(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().filter(w=>!w.webContents.getURL().includes('mode=tray')).map(w=>({id:w.id,bounds:w.getBounds()}))),nativeBefore);
  assert.equal(await settings.evaluate(()=>getComputedStyle(document.body).colorScheme),'light');
  assert.equal(await settings.locator('header').evaluate(el=>el.getBoundingClientRect().height),56);
  assert.equal(await settings.locator('#operationProgress').evaluate(el=>el.closest('header')!==null),true);
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
  const collectorConfigBefore=await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8');
  await settings.locator('#trayRange').selectOption('30');await settings.locator('#trayTheme').selectOption('light');
  for(const widget of ['trend','models'])await settings.locator('[name="trayWidgets"][value="'+widget+'"]').uncheck();
  await settings.locator('[name="trayWidgets"][value="activity"]').check();
  await settings.locator('#saveTray').click();await expect(settings.locator('#traySavedStatus')).toHaveText('小窗设置已保存。');
  assert.equal(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8'),collectorConfigBefore);
  const stored=JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_DESKTOP_DATA,'settings.json'),'utf8'));
  assert.equal(stored.trayRange,30);assert.equal(stored.trayTheme,'light');assert.deepEqual(stored.trayWidgets,['overview','activity']);
  await expect(panel.locator('[data-mini-widget="trend"]')).toBeHidden();await expect(panel.locator('[data-mini-widget="activity"]')).toBeVisible();
  await expect(panel.locator('[data-mini-range="30"]')).toHaveAttribute('aria-pressed','true');
  await expect(panel.locator('html')).toHaveAttribute('data-theme','light');
  await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
  await panel.screenshot({path:path.join(output,'desktop-tray-customized.png')});
  await panel.locator('#miniSettings').click();
  await expect(settings.locator('[data-section="traySection"]')).toHaveAttribute('aria-current','page');
  await expect(settings.locator('[data-section="traySection"]')).toBeInViewport();
  // Invalid all-hidden input must not erase the last usable popup layout.
  for(const name of ['overview','trend','models','activity'])await settings.locator('[name="trayWidgets"][value="'+name+'"]').uncheck();
  await settings.locator('#saveTray').click();await expect(settings.locator('#traySavedStatus')).toHaveText('请至少选择一个 Dashboard 模块。');
  assert.deepEqual((await settings.evaluate(()=>window.tokenflow.getState())).settings.trayWidgets,['overview','activity']);
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
  await expect.poll(async()=>(await page.evaluate(()=>window.tokenflow.getState())).pendingRequests,{timeout:30_000}).toBe(0);
  assert.deepEqual(errors,[]);
  console.log('Desktop smoke passed: standalone CLI installation, canonical Dashboard with local data, Settings with token/login, tray, shared configuration, localization, and window close.');
} finally {
  if(process.env.TOKENFLOW_SYSTEM_TEST==='1')await instance.evaluate(({app})=>app.setLoginItemSettings({openAtLogin:false,args:['--background']})).catch(()=>{});
  await instance.close(); await fs.rm(temp,{recursive:true,force:true});
}
