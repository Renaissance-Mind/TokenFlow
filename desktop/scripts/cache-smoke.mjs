import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {_electron as electron,expect} from '@playwright/test';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const cli=path.resolve(desktop,'../dist/cli.js');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-cache-acceptance-'));
const env={...process.env,TOKENFLOW_HOME:path.join(root,'data'),TOKENFLOW_SCAN_HOME:path.join(root,'sources'),TOKENFLOW_DESKTOP_DATA:path.join(root,'app'),TOKENFLOW_CLI_PATH:cli,TOKENFLOW_NODE_PATH:process.execPath};
delete env.ELECTRON_RUN_AS_NODE;
for(const key of Object.keys(env))if(/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_HOME|DSH_SESSIONS_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENUSAGE_HOME|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL)$/.test(key))delete env[key];
const file=path.join(env.TOKENFLOW_SCAN_HOME,'.codex/sessions/history.jsonl');
await fs.mkdir(path.dirname(file),{recursive:true});
const now=Date.now();
const row=n=>JSON.stringify({type:'event_msg',timestamp:new Date(now-60_000+n).toISOString(),payload:{type:'token_count',info:{total_token_usage:{input_tokens:n,output_tokens:0,total_tokens:n}}}})+'\n';
const count=2000;
await fs.writeFile(file,[JSON.stringify({type:'session_meta',payload:{id:'cache-acceptance'}}),JSON.stringify({type:'turn_context',payload:{model:'gpt-5'}}),JSON.stringify({type:'message',text:'Private transcript content '.repeat(40_000)})].join('\n')+'\n'+Array.from({length:count},(_,i)=>row(i+1)).join(''));
function request(action,runtime=process.execPath){
  const out=execFileSync(runtime,[cli,'desktop-service'],{input:JSON.stringify({action,params:{}})+'\n',env,encoding:'utf8'});
  const messages=out.trim().split('\n').map(line=>JSON.parse(line));
  const result=messages.find(message=>message.type==='result');
  if(result?.error)throw new Error(result.error);
  return {value:result.result,progress:messages.filter(message=>message.type==='progress').map(message=>message.progress)};
}
const tokens=state=>state.summary.days.reduce((sum,day)=>sum+day.tokens,0);
let instance,background;
try{
  const cold=request('scan');assert.equal(tokens(cold.value),count);assert.equal(cold.progress.at(-1).readBytes,(await fs.stat(file)).size);
  // Every request is a fresh CLI process, so this also verifies disk checkpoints.
  const warm=request('scan');assert.equal(warm.progress.at(-1).readBytes,0);assert.equal(tokens(warm.value),count);
  const standaloneNode=path.join(desktop,`node-${process.arch}`,process.platform==='win32'?'node.exe':'node');
  if(await fs.access(standaloneNode).then(()=>true,()=>false)){
    const standalone=request('scan',standaloneNode);assert.equal(standalone.progress.at(-1).readBytes,0);assert.equal(tokens(standalone.value),count);
  }
  const tail=row(count+1);await fs.appendFile(file,tail);
  const appended=request('scan');assert.equal(appended.progress.at(-1).readBytes,Buffer.byteLength(tail));assert.equal(tokens(appended.value),count+1);
  // Exercise the old popup freshness threshold with an existing cached snapshot.
  const cacheFile=path.join(env.TOKENFLOW_HOME,'local-cache.json'),metaFile=path.join(env.TOKENFLOW_HOME,'local-cache-meta.json');
  const cache=JSON.parse(await fs.readFile(cacheFile,'utf8')),meta=JSON.parse(await fs.readFile(metaFile,'utf8'));
  cache.summary.scannedAt=cache.dashboard.scannedAt=meta.summary.scannedAt=new Date(Date.now()-120_000).toISOString();
  await fs.writeFile(cacheFile,JSON.stringify(cache));
  const stat=await fs.stat(cacheFile);meta.file={file:cacheFile,dev:stat.dev,ino:stat.ino,size:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs};
  await fs.writeFile(metaFile,JSON.stringify(meta));
  background=spawn(process.execPath,['--input-type=module','-e',`import {runBackgroundCollector} from ${JSON.stringify(pathToFileURL(path.resolve(desktop,'../dist/background.js')).href)};await runBackgroundCollector({interval:100});`],{env,stdio:['ignore','ignore','pipe']});
  const errors=[];background.stderr.on('data',data=>errors.push(data.toString()));
  const executablePath=process.env.TOKENFLOW_EXECUTABLE;
  instance=await electron.launch({args:executablePath?[]:[desktop],...(executablePath?{executablePath}:{}),env,timeout:60_000});
  const page=await instance.firstWindow();await page.waitForURL(/mode=dashboard$/);
  await expect.poll(async()=>tokens(await page.evaluate(()=>window.tokenflow.getState())),{timeout:30_000}).toBe(count+1);
  await page.evaluate(()=>{window.collectionStates=[];window.tokenflow.onState(state=>window.collectionStates.push(state.busy));});
  for(let i=0;i<3;i++){
    await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('dashboard').click());
    await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
    await expect.poll(()=>instance.windows().some(window=>window.url().includes('mode=tray'))).toBe(true);
    const panel=instance.windows().find(window=>window.url().includes('mode=tray'));
    await expect(panel.locator('body')).toHaveAttribute('data-mini-loaded','true',{timeout:30_000});
    await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().includes('mode=tray')).hide());
  }
  assert.equal((await page.evaluate(()=>window.tokenflow.getState())).busy,null);
  assert.equal(await page.locator('#operationProgress').isVisible(),false);
  assert.equal((await fs.stat(cacheFile)).mtimeMs,stat.mtimeMs);
  await fs.appendFile(file,row(count+2));
  await expect.poll(async()=>tokens(await page.evaluate(()=>window.tokenflow.getState())),{timeout:30_000}).toBe(count+2);
  assert.equal(await page.evaluate(()=>window.collectionStates.some(Boolean)),false);
  assert.deepEqual(errors,[]);
  console.log('Cache acceptance passed: fresh-process warm read 0 bytes; append reads only new bytes; opening Dashboard/popup with an old cache triggers no collection; background changes update the open Dashboard without Reading files.');
}finally{
  if(instance)await instance.close();
  if(background&&background.exitCode===null){const closed=new Promise(resolve=>background.once('close',resolve));background.kill();await closed;}
  await fs.rm(root,{recursive:true,force:true});
}
