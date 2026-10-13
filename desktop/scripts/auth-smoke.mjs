import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import { runNativeAcceptance } from './smoke.mjs';
const helper=process.env.TOKENFLOW_AUTH_TEST_SERVER;
if(!helper)throw new Error('Set TOKENFLOW_AUTH_TEST_SERVER to TokenFlow_Server/scripts/desktop-test-server.mjs');
const {withDesktopTestServer}=await import(pathToFileURL(path.resolve(helper)).href);
await withDesktopTestServer(async({url,approve,request,db})=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-tauri-auth-'));
  const env={TOKENFLOW_HOME:path.join(temp,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'),TOKENFLOW_SCAN_HOME:path.join(temp,'sources'),TOKENFLOW_SERVER_URL:url,TOKENFLOW_ACCEPTANCE_REPORT:path.join(temp,'report.json')};
  let stop=false;let approval;
  try{
    approval=(async()=>{
      for(let i=0;i<700 && !stop;i++){
        const raw=await fs.readFile(env.TOKENFLOW_ACCEPTANCE_REPORT+'.progress','utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(raw){const response=await approve(JSON.parse(raw).code);assert.equal(response.status,200);return;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!stop)throw new Error('Login approval timed out');
    })();
    await runNativeAcceptance(env,'auth');await approval;
    const config=JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8'));
    assert.equal((await request('/api/device/status',undefined,config.deviceToken)).status,200);
    assert.ok(config.lastSyncAt);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM desktop_credentials WHERE revoked_at IS NULL').first()).count,1);
    const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
    const executable=process.env.TOKENFLOW_EXECUTABLE || path.join(desktop,'src-tauri/target/release',process.platform==='win32'?'tokenflow-desktop.exe':'tokenflow-desktop');
    await promisify(execFile)(executable,['--collector-sync'],{env:{...process.env,...env},timeout:60_000});
    const after=JSON.parse(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8'));assert.ok(Date.parse(after.lastSyncAt)>=Date.parse(config.lastSyncAt));
    await runNativeAcceptance(env,'restore');
    await runNativeAcceptance(env,'logout');
    assert.equal((await request('/api/device/status',undefined,config.deviceToken)).status,401);
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM desktop_credentials WHERE revoked_at IS NULL').first()).count,0);
    assert.ok(!(await fs.readFile(path.join(env.TOKENFLOW_HOME,'config.json'),'utf8')).includes('tu_dev_'));
    console.log('Native Tauri authorization, Keychain recovery, dashboard cookies, collector sync, restart and revocation passed against real Worker/D1.');
  }finally{stop=true;await approval;await fs.rm(temp,{recursive:true,force:true});}
});
