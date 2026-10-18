import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const helper=process.env.TOKENFLOW_AUTH_TEST_SERVER;
if(!helper)throw new Error('Set TOKENFLOW_AUTH_TEST_SERVER to TokenFlow_Server/scripts/desktop-test-server.mjs');
const {withDesktopTestServer}=await import(pathToFileURL(path.resolve(helper)).href);
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await withDesktopTestServer(async({url,approve,completeSignIn,request,db,userId,sessionToken})=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-desktop-auth-'));
  const env={...process.env,TOKENFLOW_HOME:path.join(temp,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'),TOKENFLOW_SCAN_HOME:path.join(temp,'sources'),TOKENFLOW_SERVER_URL:url,TOKENFLOW_NODE_PATH:process.execPath,TOKENFLOW_CLI_PATH:path.resolve(desktop,'../dist/cli.js')};
  delete env.ELECTRON_RUN_AS_NODE;
  for(const key of Object.keys(env))if(/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME)$/.test(key))delete env[key];
  await fs.mkdir(env.TOKENFLOW_SCAN_HOME,{recursive:true});await fs.mkdir(env.TOKENFLOW_HOME,{recursive:true});
  const saveCliConfig=async value=>{const file=path.join(env.TOKENFLOW_HOME,'config.json');await fs.writeFile(file+'.tmp',JSON.stringify(value),{mode:0o600});await fs.rename(file+'.tmp',file);};
  const cliCommand=(args,input)=>execFileSync(process.execPath,[env.TOKENFLOW_CLI_PATH,...args],{env,input,encoding:'utf8'});
  const cliAction=(action,params={})=>JSON.parse(cliCommand(['desktop-service'],JSON.stringify({action,params})+'\n')).result;
  const cliConfig=()=>cliAction('state').config;
  const assertCliLoggedOut=()=>{const config=cliConfig();for(const key of ['deviceToken','deviceId','apiToken','lastSyncAt'])assert.equal(config[key],undefined);};
  // An older App settings file cannot override the shared CLI configuration.
  await fs.mkdir(env.TOKENFLOW_DESKTOP_DATA,{recursive:true});
  await fs.writeFile(path.join(env.TOKENFLOW_DESKTOP_DATA,'settings.json'),JSON.stringify({serverUrl:'https://stale.example.test',deviceName:'Stale App name',paused:true,language:'en'}));
  // Seed an actual CLI device login to prove App adopts the same device/credential.
  const start=await(await request('/api/device/start',{device_name:'Existing CLI',platform:process.platform})).json();
  assert.equal((await request('/api/device/approve',{user_code:start.user_code},undefined,{Cookie:'tu_session='+sessionToken,Origin:url})).status,200);
  const linked=await(await request('/api/device/poll',{device_code:start.device_code})).json();
  assert.equal(linked.status,'approved');
  const {ingestUsageSnapshot}=await import(pathToFileURL(path.resolve(desktop,'../dist/api.js')).href);
  const {aggregateEvents}=await import(pathToFileURL(path.resolve(desktop,'../dist/usage-buckets.js')).href);
  const {parseCodexJsonl}=await import(pathToFileURL(path.resolve(desktop,'../dist/sources/codex.js')).href);
  const today=new Date().toISOString().slice(0,10);
  const cloudEvents=parseCodexJsonl([
    {type:'session_meta',payload:{session_id:'cloud-record'}},
    {type:'turn_context',payload:{model:'gpt-5.2-codex'}},
    {type:'event_msg',timestamp:today+'T01:05:00.000Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:1000,cached_input_tokens:400,output_tokens:100}}}},
  ].map(v=>JSON.stringify(v)).join('\n'),{sourcePath:'/acceptance/cloud.jsonl'});
  await ingestUsageSnapshot({serverUrl:url,uploadToken:linked.token,deviceName:'Existing CLI',platform:process.platform,buckets:aggregateEvents(cloudEvents)});

  await fs.writeFile(path.join(env.TOKENFLOW_HOME,'config.json'),JSON.stringify({serverUrl:url,deviceToken:linked.token,deviceId:linked.device_id,deviceName:'Existing CLI'}));
  let instance=await electron.launch({args:[desktop],env,timeout:60_000});
  try{
    let dashboard=await instance.firstWindow();await dashboard.waitForURL(/mode=dashboard$/);
    await expect(dashboard.locator('#app')).toBeVisible();await expect(dashboard.locator('#loginSection')).toBeHidden();
    await expect.poll(async()=>{const s=await dashboard.evaluate(()=>window.tokenflow.getState());
      if(s.error)throw new Error(s.error);
      return s.summary&&!s.busy&&s.hasDashboard&&s.dashboardSource==='cloud' ? true : {hasCollector:s.hasCollector,hasDashboard:s.hasDashboard,source:s.dashboardSource,notice:s.notice};
    },{timeout:60_000}).toBe(true);
    await dashboard.evaluate(()=>{window.dashboardIdentity=document.getElementById('app');});
    let state=await dashboard.evaluate(()=>window.tokenflow.getState());assert.equal(state.cli.source,'installed');assert.equal(state.hasCollector,true);assert.equal(state.hasDashboard,true);assert.equal(state.dashboardSource,'cloud');
    assert.equal(state.settings.deviceName,'Existing CLI');assert.equal(state.settings.serverUrl,url);assert.equal(state.settings.paused,false);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_DESKTOP_DATA,'settings.json'),'utf8')),{launchAtLogin:true,trayMetric:'cost',language:'en',trayRange:7,trayTheme:'system',trayWidgets:['overview','trend','models']});
    assert.equal(JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8')).deviceToken,linked.token);
    const nativeMain=await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({id:w.id,bounds:w.getBounds()})));
    await dashboard.evaluate(()=>window.tokenflow.openSettings());
    await expect.poll(()=>instance.windows().some(p=>p.url().includes('mode=settings'))).toBe(true);
    let settings=instance.windows().find(p=>p.url().includes('mode=settings'));await settings.waitForLoadState('domcontentloaded');
    assert.deepEqual(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({id:w.id,bounds:w.getBounds()}))),nativeMain);
    assert.equal(await settings.evaluate(()=>getComputedStyle(document.body).colorScheme),'light');
    await expect(settings.locator('#loginSection')).toBeHidden();
    await expect(settings.locator('#tokenForm')).toBeHidden();
    await settings.setViewportSize({width:1440,height:960});
    await expect.poll(()=>settings.evaluate(()=>innerHeight)).toBe(960);
    await settings.screenshot({path:path.join(desktop,'test-results','settings-light-connected.png')});
    const reading=settings.evaluate(()=>window.tokenflow.scan());
    await expect(settings.locator('#operationProgress')).toBeVisible();
    await settings.screenshot({path:path.join(desktop,'test-results','settings-light-reading.png')});
    await fs.writeFile(path.join(desktop,'test-results','settings-light-metrics.json'),JSON.stringify(await settings.evaluate(()=>({viewport:[innerWidth,innerHeight],dpr:devicePixelRatio,documentHeight:document.documentElement.scrollHeight,sections:Object.fromEntries(['pageTitle','authentication','preferencesSection','cliSection','update'].map(id=>{const el=document.getElementById(id),b=el.getBoundingClientRect();return [id,{x:b.x,y:b.y,width:b.width,height:b.height}];}))})),null,2));
    await reading;
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM desktop_credentials').first()).count,0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM desktop_links').first()).count,0);
    await expect.poll(async()=>{const s=await settings.evaluate(()=>window.tokenflow.getState());return s.hasDashboard&&s.dashboardSource==='cloud'&&!s.loginBusy&&!s.busy;},{timeout:60_000}).toBe(true);
    state=await settings.evaluate(()=>window.tokenflow.getState());assert.equal(state.account.name,'Desktop acceptance');
    const config=JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8'));
    assert.equal(config.deviceId,linked.device_id);assert.equal(config.deviceToken,linked.token);assert.ok(config.lastSyncAt);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM devices WHERE user_id=?1').bind(userId).first()).count,1);
    await assert.rejects(fs.access(path.join(env.TOKENFLOW_DESKTOP_DATA,'desktop-auth.bin')),error=>error.code==='ENOENT');
    await expect(dashboard.locator('#totalTokens')).toHaveAttribute('title','1,100');
    await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
    await expect.poll(()=>instance.windows().some(page=>page.url().includes('mode=tray'))).toBe(true);
    let mini=instance.windows().find(page=>page.url().includes('mode=tray'));await mini.waitForLoadState('domcontentloaded');
    await expect(mini.locator('body')).toHaveAttribute('data-mini-loaded','true');
    await expect(mini.locator('#miniSource')).toHaveText('Synced data');
    await expect(mini.locator('#totalTokens')).toHaveAttribute('title','1,100');
    assert.equal(await dashboard.evaluate(()=>location.href), 'tokenflow://dashboard/index.html?mode=dashboard');
    assert.equal(await dashboard.evaluate(()=>window.dashboardIdentity===document.getElementById('app')),true);
    assert.equal(await instance.evaluate(({webContents})=>webContents.getAllWebContents().some(c=>/^https?:/.test(c.getURL()))),false);
    await dashboard.screenshot({path:path.join(desktop,'test-results','desktop-dashboard-cloud.png')});
    await settings.evaluate(()=>window.tokenflow.saveSettings({deviceName:'App shared settings',paused:true,trayMetric:'tokens'}));
    let shared=cliConfig();assert.equal(shared.deviceName,'App shared settings');assert.equal(shared.autoSyncPaused,true);assert.equal(shared.deviceToken,linked.token);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_DESKTOP_DATA,'settings.json'),'utf8')),{launchAtLogin:true,trayMetric:'tokens',language:'en',trayRange:7,trayTheme:'system',trayWidgets:['overview','trend','models']});
    cliCommand(['device-name','CLI renamed device','--local']);cliAction('configure',{paused:false});
    await expect.poll(async()=>{const s=await settings.evaluate(()=>window.tokenflow.getState());return s.settings.deviceName==='CLI renamed device'&&!s.settings.paused;},{timeout:30_000}).toBe(true);
    await expect(settings.locator('#deviceName')).toHaveValue('CLI renamed device');await expect(settings.locator('#paused')).not.toBeChecked();
    await settings.evaluate(()=>window.tokenflow.saveSettings({paused:true}));await settings.evaluate(()=>window.tokenflow.sync());
    assert.equal((await settings.evaluate(()=>window.tokenflow.getState())).error,null);
    await instance.close();
    // The CLI persists, and the same single Dashboard resumes cloud authorization.
    instance=await electron.launch({args:[desktop],env,timeout:60_000});dashboard=await instance.firstWindow();await dashboard.waitForURL(/mode=dashboard$/);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).dashboardSource==='cloud',{timeout:60_000}).toBe(true);
    assert.equal(instance.windows().some(p=>/mode=(login|local)$/.test(p.url())),false);
    await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
    await expect.poll(()=>instance.windows().some(page=>page.url().includes('mode=tray'))).toBe(true);
    mini=instance.windows().find(page=>page.url().includes('mode=tray'));await mini.waitForLoadState('domcontentloaded');
    await expect(mini.locator('body')).toHaveAttribute('data-mini-loaded','true');
    // CLI account changes are adopted while App stays open, even with a stale cookie.
    await dashboard.evaluate(()=>{window.dashboardIdentity=document.getElementById('app');});
    const otherSession='tu_sess_'+randomBytes(32).toString('base64url'),otherNow=new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO users(id,email,name,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)').bind('usr_other_cli','other-cli@example.test','Other CLI account',otherNow),
      db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?1,?2,?3,?4,?5)').bind('sess_other_cli','usr_other_cli',createHash('sha256').update(otherSession).digest('base64url'),otherNow,new Date(Date.now()+3600_000).toISOString()),
    ]);
    const otherFlow=await(await request('/api/device/start',{device_name:'Other CLI',platform:process.platform})).json();
    assert.equal((await request('/api/device/approve',{user_code:otherFlow.user_code},undefined,{Cookie:'tu_session='+otherSession,Origin:url})).status,200);
    const otherLinked=await(await request('/api/device/poll',{device_code:otherFlow.device_code})).json();
    assert.equal(otherLinked.status,'approved');
    assert.equal((await(await request('/api/me',undefined,otherLinked.token)).json()).user.id,'usr_other_cli');
    await instance.evaluate(async({session},{url,token})=>session.fromPartition('persist:tokenflow-dashboard').cookies.set({url,name:'tu_session',value:token,path:'/'}),{url,token:sessionToken});
    await saveCliConfig({...config,deviceToken:otherLinked.token,deviceId:otherLinked.device_id,deviceName:'Other CLI',autoSyncPaused:true});
    await expect.poll(async()=>{const s=await dashboard.evaluate(()=>window.tokenflow.getState());if(s.notice||s.error)throw new Error('CLI account adoption: '+(s.notice||s.error));return s.account?.id;},{timeout:30_000}).toBe('usr_other_cli');
    await expect(dashboard.locator('#totalTokens')).toHaveAttribute('title','0');
    await expect(mini.locator('#totalTokens')).toHaveAttribute('title','0');
    assert.equal(await dashboard.evaluate(()=>window.dashboardIdentity===document.getElementById('app')),true);
    await saveCliConfig({...config,autoSyncPaused:true});
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).account?.id,{timeout:30_000}).toBe(userId);
    await expect(dashboard.locator('#totalTokens')).toHaveAttribute('title','1,100');
    // A failed cloud data request keeps the exact same page and chart elements.
    await dashboard.evaluate(()=>{window.dashboardIdentity=document.getElementById('app');});
    await instance.evaluate(({session},server)=>{
      session.fromPartition('persist:tokenflow-dashboard').webRequest.onBeforeRequest({urls:[server+'/api/usage/summary*']},(_details,callback)=>callback({cancel:true}));
    },url);
    await dashboard.evaluate(()=>window.tokenflowDashboard.refresh());
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).dashboardSource).toBe('local');
    assert.equal(await dashboard.evaluate(()=>window.dashboardIdentity===document.getElementById('app')),true);
    await expect(dashboard.locator('#app')).toBeVisible();
    await expect(dashboard.locator('#totalTokens')).toHaveAttribute('title','0');
    await instance.evaluate(({session})=>session.fromPartition('persist:tokenflow-dashboard').webRequest.onBeforeRequest(null));
    await dashboard.evaluate(()=>window.tokenflow.dashboard());
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).dashboardSource).toBe('cloud');
    await dashboard.evaluate(()=>window.tokenflow.logout());await expect.poll(async()=>!(await dashboard.evaluate(()=>window.tokenflow.getState())).hasCollector).toBe(true);
    assertCliLoggedOut();
    await expect(dashboard.locator('#app')).toBeVisible();assert.equal((await request('/api/device/status',undefined,config.deviceToken)).status,200);
    // First-time browser sign-in still works when no CLI credential exists.
    await dashboard.locator('#desktopSignIn').click();
    await dashboard.locator('#desktopLoginGithub').click();
    await expect.poll(async()=>!!(await dashboard.evaluate(()=>window.tokenflow.getState())).login).toBe(true);
    await expect(dashboard.locator('#desktopLoginWaiting')).toContainText('connect automatically');
    assert.equal((await dashboard.evaluate(()=>window.tokenflow.getState())).hasDashboard,false);

    const code=(await dashboard.evaluate(()=>window.tokenflow.getState())).login.code;await completeSignIn(code);
    await expect.poll(async()=>{const s=await dashboard.evaluate(()=>window.tokenflow.getState());return s.hasDashboard&&!s.loginBusy&&!s.busy;},{timeout:60_000}).toBe(true);
    await expect(dashboard.locator('#desktopLoginDialog')).toBeHidden();
    assert.equal((await dashboard.evaluate(()=>window.tokenflow.getState())).error,null);
    const encrypted=await fs.readFile(path.join(env.TOKENFLOW_DESKTOP_DATA,'desktop-auth.bin'));assert.ok(!encrypted.toString().includes('tu_desktop_'));
    const browserConfig=JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8'));
    shared=cliConfig();assert.equal(shared.deviceToken,browserConfig.deviceToken);assert.equal(shared.deviceId,browserConfig.deviceId);assert.equal(shared.apiToken,undefined);
    // Switching accounts in Settings replaces the CLI connection only after approval.
    await dashboard.evaluate(()=>window.tokenflow.openSettings());
    await expect.poll(()=>instance.windows().some(p=>p.url().includes('mode=settings'))).toBe(true);
    settings=instance.windows().find(p=>p.url().includes('mode=settings'));await settings.waitForLoadState('domcontentloaded');
    await settings.locator('#switchAccount').click();await expect(settings.locator('#google')).toBeVisible();await expect(settings.locator('#tokenForm')).toBeVisible();
    assert.equal(cliConfig().deviceToken,browserConfig.deviceToken);
    await settings.locator('#switchAccount').click();await expect(settings.locator('#loginSection')).toBeHidden();assert.equal(cliConfig().deviceToken,browserConfig.deviceToken);
    await settings.locator('#switchAccount').click();await settings.locator('#google').click();
    await expect.poll(async()=>!!(await settings.evaluate(()=>window.tokenflow.getState())).login).toBe(true);
    const switchCode=(await settings.evaluate(()=>window.tokenflow.getState())).login.code;
    assert.equal(cliConfig().deviceToken,browserConfig.deviceToken);
    assert.equal((await request('/api/desktop/approve',{user_code:switchCode},undefined,{Cookie:'tu_session='+otherSession,Origin:url})).status,200);
    await expect.poll(async()=>{const s=await settings.evaluate(()=>window.tokenflow.getState());return s.account?.id==='usr_other_cli'&&!s.loginBusy&&!s.busy;},{timeout:60_000}).toBe(true);
    shared=cliConfig();assert.notEqual(shared.deviceToken,browserConfig.deviceToken);assert.notEqual(shared.deviceId,browserConfig.deviceId);assert.equal(shared.lastSyncAt,undefined);
    assert.equal((await(await request('/api/me',undefined,shared.deviceToken)).json()).user.id,'usr_other_cli');
    await expect(dashboard.locator('#totalTokens')).toHaveAttribute('title','0');await expect(settings.locator('#loginSection')).toBeHidden();
    assert.equal(await dashboard.evaluate(()=>window.dashboardIdentity===document.getElementById('app')),true);
    await dashboard.evaluate(()=>window.tokenflow.logout());assertCliLoggedOut();assert.equal((await request('/api/device/status',undefined,shared.deviceToken)).status,401);
    // A read-write API token authorizes the cloud view and the same collector.
    const apiToken='tu_api_'+randomBytes(24).toString('base64url');const now=new Date().toISOString();
    await db.prepare('INSERT INTO api_keys(id,user_id,name,prefix,last_four,token_hash,scope,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)').bind('key_desktop_test',userId,'Desktop token',apiToken.slice(0,12),apiToken.slice(-4),createHash('sha256').update(apiToken).digest('base64url'),'read_write',now).run();
    await dashboard.evaluate(token=>window.tokenflow.setApiToken(token),apiToken);
    await expect.poll(async()=>{const s=await dashboard.evaluate(()=>window.tokenflow.getState());return s.dashboardSource==='cloud'&&s.hasCollector;},{timeout:60_000}).toBe(true);
    const viewUser=await dashboard.evaluate(()=>window.tokenflow.dashboardRequest('/api/me').then(d=>d.user.id));
    assert.equal(viewUser,userId);
    shared=cliConfig();assert.equal(shared.apiToken,apiToken);assert.equal(shared.deviceToken,undefined);assert.equal(shared.deviceId,undefined);assert.equal(shared.lastSyncAt,undefined);
    assert.equal(await dashboard.evaluate(()=>window.dashboardIdentity===document.getElementById('app')),true);
    assert.equal(JSON.stringify(await dashboard.evaluate(()=>window.tokenflow.getState())).includes(apiToken),false);
    await dashboard.evaluate(()=>window.tokenflow.logout());
    assertCliLoggedOut();
    // Actual CLI logout is observed by the running App as well.
    await dashboard.evaluate(token=>window.tokenflow.setApiToken(token),apiToken);cliCommand(['logout']);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).hasCollector,{timeout:30_000}).toBe(false);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).pendingRequests,{timeout:30_000}).toBe(0);
    assertCliLoggedOut();await expect(dashboard.locator('#app')).toBeVisible();
    console.log('Desktop authorization smoke passed: shared App/CLI login, logout, account switching, API token and settings in both directions; migrated preferences; one Dashboard across synced/local data, restart and recovery.');
  }finally{await instance.close();await fs.rm(temp,{recursive:true,force:true});}
});
