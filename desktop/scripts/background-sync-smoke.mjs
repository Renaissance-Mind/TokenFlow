import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron as electron,expect} from '@playwright/test';
const helper=process.env.TOKENFLOW_AUTH_TEST_SERVER;
if(!helper)throw new Error('Set TOKENFLOW_AUTH_TEST_SERVER to the real Worker/D1 desktop test helper.');
const {withDesktopTestServer}=await import(pathToFileURL(path.resolve(helper)).href);
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),cli=path.resolve(desktop,'../dist/cli.js');
await withDesktopTestServer(async({url,request,db,sessionToken})=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-background-sync-'));
  const env={...process.env,TOKENFLOW_HOME:path.join(root,'data'),TOKENFLOW_SCAN_HOME:path.join(root,'sources'),TOKENFLOW_DESKTOP_DATA:path.join(root,'app'),TOKENFLOW_CLI_PATH:cli,TOKENFLOW_NODE_PATH:process.execPath};
  delete env.ELECTRON_RUN_AS_NODE;
  for(const key of Object.keys(env))if(/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_HOME|DSH_SESSIONS_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENUSAGE_HOME|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL)$/.test(key))delete env[key];
  const created=await request('/api/api-keys',{name:'Background collector acceptance',scope:'read_write'},undefined,{Cookie:'tu_session='+sessionToken,Origin:url});
  assert.equal(created.status,200);const key=await created.json();
  await fs.mkdir(env.TOKENFLOW_HOME,{recursive:true});
  await fs.writeFile(path.join(env.TOKENFLOW_HOME,'config.json'),JSON.stringify({serverUrl:url,apiToken:key.key,deviceName:'Background acceptance'}));
  const file=path.join(env.TOKENFLOW_SCAN_HOME,'.codex/sessions/a.jsonl');await fs.mkdir(path.dirname(file),{recursive:true});
  const now=Date.now(),today=new Date().toISOString().slice(0,10);
  const row=n=>JSON.stringify({type:'event_msg',timestamp:new Date(now+n).toISOString(),payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,output_tokens:0,total_tokens:n}}}})+'\n';
  await fs.writeFile(file,[{type:'session_meta',payload:{id:'background'}},{type:'turn_context',payload:{model:'gpt-5'}}].map(row=>JSON.stringify(row)).join('\n')+'\n'+row(100));
  const remote=async()=>{
    const response=await request(`/api/usage/summary?from=${today}&to=${today}`,undefined,undefined,{Cookie:'tu_session='+sessionToken});
    assert.equal(response.status,200);return Number((await response.json()).totals.total_tokens);
  };
  const status=async()=>JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'background-status.json'),'utf8'));
  const local=async()=>JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'local-cache.json'),'utf8')).dashboard.buckets.reduce((sum,row)=>sum+row.totalTokens,0);
  const action=(action,params)=>execFileSync(process.execPath,[cli,'desktop-service'],{input:JSON.stringify({action,params})+'\n',env,encoding:'utf8'});
  let instance;
  const child=spawn(process.execPath,['--input-type=module','-e',`import {runBackgroundCollector} from ${JSON.stringify(pathToFileURL(path.resolve(desktop,'../dist/background.js')).href)};await runBackgroundCollector({interval:100,syncInterval:1000});`],{env,stdio:'ignore'});
  try{
    await expect.poll(remote,{timeout:30_000}).toBe(100);
    console.log("Background upload passed.");
    instance=await electron.launch({args:[desktop],env,timeout:60_000});
    const page=await instance.firstWindow();await page.waitForURL(/mode=dashboard$/);
    await expect.poll(async()=>(await page.evaluate(()=>window.tokenflow.getState())).dashboardSource).toBe('cloud');
    await expect(page.locator('#totalTokens')).toHaveAttribute('title','100');
    await page.evaluate(()=>{window.readingStates=[];window.tokenflow.onState(state=>window.readingStates.push(state.busy));});
    await fs.appendFile(file,row(150));
    await expect.poll(remote,{timeout:30_000}).toBe(150);
    await expect(page.locator('#totalTokens')).toHaveAttribute('title','150',{timeout:30_000});
    console.log('Cloud Dashboard followed the background upload.');
    assert.equal(await page.evaluate(()=>window.readingStates.some(Boolean)),false);
    await instance.close();instance=null;
    // Revocation exercises the real API authorization path while local collection continues.
    await db.prepare('UPDATE api_keys SET revoked_at=?1 WHERE id=?2').bind(new Date().toISOString(),key.id).run();
    await expect.poll(async()=>(await status()).error,{timeout:30_000}).toBeTruthy();
    await fs.appendFile(file,row(155));
    await expect.poll(local,{timeout:30_000}).toBe(155);
    assert.ok((await status()).error);
    await db.prepare('UPDATE api_keys SET revoked_at=NULL WHERE id=?1').bind(key.id).run();
    await expect.poll(remote,{timeout:30_000}).toBe(155);
    await expect.poll(async()=>(await status()).error,{timeout:30_000}).toBe(null);
    action('configure',{paused:true});
    await fs.appendFile(file,row(180));
    await new Promise(resolve=>setTimeout(resolve,350));assert.equal(await local(),155);
    action('configure',{paused:false});
    await expect.poll(remote,{timeout:30_000}).toBe(180);
    console.log('Real Worker/D1 background acceptance passed: upload, live cloud Dashboard refresh without collection UI, revoked-key error persistence, recovery, pause and resume.');
  }finally{
    if(instance)await instance.close();
    if(child.exitCode===null){const closed=new Promise(resolve=>child.once('close',resolve));child.kill();await closed;}
    await fs.rm(root,{recursive:true,force:true});
  }
});
