import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron as electron,expect} from '@playwright/test';
import {parseCodexJsonl} from '../../dist/sources/codex.js';
import {aggregateEvents} from '../../dist/usage-buckets.js';
import {dashboardCache,localDashboardApi} from '../../dist/local-dashboard.js';
import {summarizeLocal} from '../../dist/local-summary.js';
import {ingestUsageSnapshot} from '../../dist/api.js';
import {usageRange} from '../../dist/usage-calendar.js';

const helper=process.env.TOKENFLOW_AUTH_TEST_SERVER;
if(!helper)throw new Error('Set TOKENFLOW_AUTH_TEST_SERVER to the server desktop-test-server.mjs');
const {withDesktopTestServer}=await import(pathToFileURL(path.resolve(helper)).href);
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
await withDesktopTestServer(async({url,request,db,userId,sessionToken})=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-statistics-'));
  const zone='Asia/Shanghai',day=new Date().toLocaleDateString('en-CA',{timeZone:zone});
  const range=usageRange(new URLSearchParams({from:day,to:day,time_zone:zone}));
  const env={...process.env,TZ:zone,TOKENFLOW_HOME:path.join(root,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(root,'app'),TOKENFLOW_SCAN_HOME:path.join(root,'sources'),TOKENFLOW_SERVER_URL:url,TOKENFLOW_NODE_PATH:process.execPath,TOKENFLOW_CLI_PATH:path.resolve(desktop,'../dist/cli.js')};
  delete env.ELECTRON_RUN_AS_NODE;
  for(const key of Object.keys(env))if(/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME)$/.test(key))delete env[key];
  for(const dir of [env.TOKENFLOW_HOME,env.TOKENFLOW_DESKTOP_DATA,env.TOKENFLOW_SCAN_HOME])await fs.mkdir(dir,{recursive:true});
  const link=async(name,session=sessionToken)=>{
    const start=await(await request('/api/device/start',{device_name:name,platform:process.platform})).json();
    assert.equal((await request('/api/device/approve',{user_code:start.user_code},undefined,{Cookie:'tu_session='+session,Origin:url})).status,200);
    const linked=await(await request('/api/device/poll',{device_code:start.device_code})).json();
    assert.equal(linked.status,'approved');return linked;
  };
  const first=await link('This Mac'),second=await link('Other Mac');
  async function eventsFor(name,records,save){
    const events=[];
    for(const [index,[offset,input]] of records.entries()){
      const file=path.join(env.TOKENFLOW_SCAN_HOME,'.codex','sessions',name+'-'+index+'.jsonl');
      const json=[
        {type:'session_meta',payload:{id:name+'-'+index}},
        {type:'turn_context',payload:{model:'gpt-5.2-codex'}},
        {type:'event_msg',timestamp:new Date(range.start+offset).toISOString(),payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:0,output_tokens:input/10,total_tokens:input*1.1}}}},
      ].map(row=>JSON.stringify(row)).join('\n')+'\n';
      if(save){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,json);}
      events.push(...parseCodexJsonl(json,{sourcePath:file}));
    }
    return events;
  }
  const localEvents=await eventsFor('local',[[-1800000,9000],[900000,1000],[9*3600000,2000],[86400000+900000,8000]],true);
  const remoteEvents=await eventsFor('remote',[[5*3600000,3000]],false);
  const localBuckets=aggregateEvents(localEvents),remoteBuckets=aggregateEvents(remoteEvents);
  for(const [linked,name,buckets] of [[first,'This Mac',localBuckets],[second,'Other Mac',remoteBuckets]])
    await ingestUsageSnapshot({serverUrl:url,uploadToken:linked.token,deviceName:name,platform:process.platform,buckets});
  const config={serverUrl:url,deviceToken:first.token,deviceId:first.device_id,deviceName:'This Mac',autoSyncPaused:true};
  await fs.writeFile(path.join(env.TOKENFLOW_HOME,'config.json'),JSON.stringify(config));
  await fs.writeFile(path.join(env.TOKENFLOW_HOME,'local-cache.json'),JSON.stringify({revision:'acceptance',summary:summarizeLocal(localEvents,[],[]),dashboard:dashboardCache(localBuckets)}));
  await fs.writeFile(path.join(env.TOKENFLOW_DESKTOP_DATA,'settings.json'),JSON.stringify({language:'en',trayRange:1}));
  const query=new URLSearchParams({from:day,to:day,time_zone:zone}).toString();
  const get=async endpoint=>{const response=await request(endpoint,undefined,first.token);assert.equal(response.status,200);return response.json();};
  const summary=await get('/api/usage/summary?'+query);
  assert.equal(summary.totals.total_tokens,'6600');
  assert.equal(summary.from,range.fromIso);assert.equal(summary.to,range.toIso);assert.equal(summary.time_zone,zone);
  const heatmap=await get('/api/usage/heatmap?'+query),hourly=await get('/api/usage/hourly?'+query);
  for(const payload of [heatmap,hourly]){assert.equal(payload.total_tokens,summary.totals.total_tokens);assert.equal(payload.total_cost_usd,summary.totals.total_cost_usd);}
  const localSummary=localDashboardApi(dashboardCache(localBuckets),config,'/api/usage/summary?'+query);
  const single=await get('/api/usage/summary?'+query+'&device_id='+first.device_id);
  assert.equal(single.totals.total_tokens,'3300');assert.deepEqual(single.totals,localSummary.totals);
  const invalid=await request('/api/usage/summary?'+query.replace('Asia%2FShanghai','Invalid%2FZone'),undefined,first.token);assert.equal(invalid.status,400);
  let instance;
  try{
    const executablePath=process.env.TOKENFLOW_EXECUTABLE;
    instance=await electron.launch({args:executablePath?[]:[desktop],...(executablePath?{executablePath}:{}),env,timeout:60000});
    const dashboard=await instance.firstWindow();await dashboard.waitForURL(/mode=dashboard$/);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).usageToday?.tokens,{timeout:60000}).toBe(6600);
    await dashboard.evaluate(()=>{document.getElementById('from').value=window.tokenflowDashboard.currentDate();document.getElementById('to').value=window.tokenflowDashboard.currentDate();return window.tokenflowDashboard.refresh();});
    await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
    await expect.poll(()=>instance.windows().some(page=>page.url().includes('mode=tray'))).toBe(true);
    const popup=instance.windows().find(page=>page.url().includes('mode=tray'));await popup.waitForLoadState('domcontentloaded');
    const assertSurfaces=async(tokens,cost)=>{
      for(const page of [dashboard,popup])await expect(page.locator('#totalTokens')).toHaveAttribute('title',Number(tokens).toLocaleString('en-US'),{timeout:30000});
      for(const page of [dashboard,popup])await expect(page.locator('#totalCost')).toHaveText('$'+Number(cost).toFixed(2));
      const state=await dashboard.evaluate(()=>window.tokenflow.getState());
      assert.equal(state.usageToday.tokens,Number(tokens));assert.equal(state.usageToday.costUsd,Number(cost));
      assert.equal(state.usageToday.timeZone,zone);
      const menu=await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').label);
      assert.ok(menu.endsWith('$'+Number(cost).toFixed(2)),menu);
    };
    await assertSurfaces(6600,summary.totals.total_cost_usd);
    // A local scan can change dramatically without leaking local-only totals
    // into a menu that is currently showing the cloud account.
    const cacheFile=path.join(env.TOKENFLOW_HOME,'local-cache.json');
    const cached=JSON.parse(await fs.readFile(cacheFile,'utf8'));cached.summary.scannedAt=new Date().toISOString();cached.summary.today.costUsd=999;cached.summary.today.tokens=999999;
    await fs.writeFile(cacheFile+'.tmp',JSON.stringify(cached));await fs.rename(cacheFile+'.tmp',cacheFile);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).summary?.today.tokens).toBe(999999);
    await assertSurfaces(6600,summary.totals.total_cost_usd);
    // Offline mode uses real network failure, never intercepted API responses.
    await instance.evaluate(async({session})=>{await session.fromPartition('persist:tokenflow-dashboard').setProxy({proxyRules:'http=127.0.0.1:1',proxyBypassRules:'<-loopback>'});});
    await dashboard.evaluate(()=>window.tokenflow.refreshDashboard());
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).dashboardStale,{timeout:30000}).toBe(true);
    await assertSurfaces(6600,summary.totals.total_cost_usd);
    await instance.evaluate(async({session})=>{await session.fromPartition('persist:tokenflow-dashboard').setProxy({mode:'direct'});});
    // New synced usage refreshes every surface from one response.
    const added=await eventsFor('added',[[6*3600000,4000]],false);
    await ingestUsageSnapshot({serverUrl:url,uploadToken:second.token,deviceName:'Other Mac',platform:process.platform,buckets:aggregateEvents([...remoteEvents,...added])});
    await dashboard.evaluate(()=>window.tokenflow.refreshDashboard());
    const updated=await get('/api/usage/summary?'+query);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).usageToday?.tokens,{timeout:30000}).toBe(11000);
    await assertSurfaces(11000,updated.totals.total_cost_usd);
    // A second real account must never see the previous account's cached today.
    const accountToken=randomBytes(32).toString('base64url'),accountId='usr_other_account',at=new Date().toISOString();
    await db.batch([
      db.prepare('INSERT INTO users(id,email,name,created_at,updated_at) VALUES(?1,?2,?3,?4,?4)').bind(accountId,'other@example.test','Second account',at),
      db.prepare('INSERT INTO sessions(id,user_id,token_hash,created_at,expires_at) VALUES(?1,?2,?3,?4,?5)').bind('session_other',accountId,createHash('sha256').update(accountToken).digest('base64url'),at,new Date(Date.now()+3600000).toISOString()),
    ]);
    const third=await link('Other account Mac',accountToken);
    const thirdEvents=await eventsFor('other-account',[[7*3600000,5000]],false);
    await ingestUsageSnapshot({serverUrl:url,uploadToken:third.token,deviceName:'Other account Mac',platform:process.platform,buckets:aggregateEvents(thirdEvents)});
    const saveConfig=async value=>{const file=path.join(env.TOKENFLOW_HOME,'config.json');await fs.writeFile(file+'.tmp',JSON.stringify(value));await fs.rename(file+'.tmp',file);};
    await saveConfig({...config,deviceToken:third.token,deviceId:third.device_id});
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).account?.id,{timeout:30000}).toBe(accountId);
    const thirdSummary=await(await request('/api/usage/summary?'+query,undefined,third.token)).json();
    await assertSurfaces(5500,thirdSummary.totals.total_cost_usd);
    await saveConfig(config);
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).account?.id,{timeout:30000}).toBe(userId);
    await assertSurfaces(11000,updated.totals.total_cost_usd);
    // Revoking cloud access moves every surface to the same local snapshot.
    await db.prepare('UPDATE devices SET revoked_at = ?1 WHERE id = ?2').bind(new Date().toISOString(),first.device_id).run();
    await dashboard.evaluate(()=>window.tokenflow.refreshDashboard());
    await expect.poll(async()=>(await dashboard.evaluate(()=>window.tokenflow.getState())).dashboardSource,{timeout:30000}).toBe('local');
    await assertSurfaces(3300,localSummary.totals.total_cost_usd);
    await fs.mkdir(path.join(desktop,'test-results'),{recursive:true});
    await instance.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=tray'));win.show();win.focus();});
    await popup.screenshot({path:path.join(desktop,'test-results','statistics-consistency.png')});
    console.log('PASS: real Worker/D1 and Electron agree across menu, popup, Dashboard, local/cloud, midnight boundaries, delayed sync, offline cache, recovery, account switching and revoked authorization.');
  }finally{if(instance)await instance.close();await fs.rm(root,{recursive:true,force:true});}
});
