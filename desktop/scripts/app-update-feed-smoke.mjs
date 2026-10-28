import {_electron as electron,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const executablePath=process.env.TOKENFLOW_EXECUTABLE||path.join(desktop,'release',process.platform==='win32'?'win-unpacked':process.arch==='arm64'?'mac-arm64':'mac',process.platform==='win32'?'TokenFlow.exe':'TokenFlow.app/Contents/MacOS/TokenFlow');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-app-feed-'));
const env={...process.env,TOKENFLOW_HOME:path.join(root,'collector'),TOKENUSAGE_HOME:path.join(root,'collector'),TOKENFLOW_SCAN_HOME:path.join(root,'sources'),TOKENFLOW_DESKTOP_DATA:path.join(root,'app')};
delete env.ELECTRON_RUN_AS_NODE;delete env.TOKENFLOW_CLI_PATH;delete env.TOKENFLOW_NODE_PATH;
for(const key of Object.keys(env))if(/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL)$/.test(key))delete env[key];
await fs.mkdir(env.TOKENFLOW_SCAN_HOME,{recursive:true});
let instance;
try{
  instance=await electron.launch({executablePath,args:[],env,timeout:60_000});
  const page=await instance.firstWindow();await page.waitForURL(/mode=dashboard$/);
  await expect.poll(()=>page.evaluate(()=>!!window.tokenflow),{timeout:30_000}).toBe(true);
  await instance.evaluate(({session})=>{
    globalThis.updateRequests=[];
    for(const current of [session.defaultSession,session.fromPartition('electron-updater',{cache:false})]){
      current.webRequest.onBeforeRequest({urls:['https://api.github.com/*','https://github.com/Renaissance-Mind/TokenFlow/releases/download/*']},(details,callback)=>{
        globalThis.updateRequests.push(details.url);
        callback({cancel:new URL(details.url).hostname==='api.github.com'});
      });
    }
  });
  await page.evaluate(()=>window.tokenflow.checkUpdate());
  const state=await page.evaluate(()=>window.tokenflow.getState());
  assert.ok(['current','available'].includes(state.update.status),JSON.stringify(state.update));
  const requests=await instance.evaluate(()=>globalThis.updateRequests);
  assert.ok(requests.some(url=>url.includes('/desktop-latest/latest')),'Static manifest was fetched');
  assert.equal(requests.some(url=>new URL(url).hostname==='api.github.com'),false,'No anonymous GitHub API request');
  console.log(JSON.stringify({appVersion:state.version,status:state.update.status,githubRestRequests:0,staticFeedVerified:true}));
}finally{
  if(instance)await instance.close();
  await fs.rm(root,{recursive:true,force:true});
}
