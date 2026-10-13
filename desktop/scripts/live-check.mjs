import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-live-check-'));
const env = { ...process.env,TOKENFLOW_HOME:path.join(temp,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'),TOKENFLOW_SCAN_HOME:path.join(temp,'sources') };
delete env.ELECTRON_RUN_AS_NODE;
await fs.mkdir(env.TOKENFLOW_SCAN_HOME,{recursive:true});
const instance = await electron.launch({args:[desktop],env,timeout:60_000});
try {
  for (const server of ['https://tokenflow.renaissancemind.ai','https://tokenusage.renaissancemind.ai']) {
    for (const provider of ['github','google']) {
      const verifier = randomBytes(32).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const result = await instance.evaluate(async ({net},{server,provider,verifier,challenge}) => {
        const request = (endpoint,body) => net.fetch(server+endpoint,{method:body === undefined ? 'GET' : 'POST',headers:{'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(30_000)});
        const pricing = await request('/api/pricing/status');
        const start = await request('/api/desktop/start',{provider,code_challenge:challenge,device_name:'Desktop deployment verification',platform:'darwin'});
        const flow = await start.json();
        if (!start.ok) throw new Error(`${server} ${provider} desktop start ${start.status}: ${flow.error}`);
        const poll = await request('/api/desktop/poll',{code:flow.code,code_verifier:verifier});
        const login = await net.fetch(flow.login_url,{redirect:'manual',signal:AbortSignal.timeout(30_000)});
        const verify = await request('/desktop/verify?code='+encodeURIComponent(flow.user_code));
        return {pricing:pricing.status,start:start.status,poll:poll.status,pending:(await poll.json()).status,login:login.status,providerHost:new URL(login.headers.get('location')).hostname,verify:verify.status};
      },{server,provider,verifier,challenge});
      assert.deepEqual(result,{pricing:200,start:200,poll:200,pending:'pending',login:302,providerHost:provider === 'google' ? 'accounts.google.com' : 'github.com',verify:200});
      console.log(new URL(server).hostname+' '+provider+': live pricing, desktop start/poll, approval page, and provider redirect passed.');
    }
  }
} finally { await instance.close(); await fs.rm(temp,{recursive:true,force:true}); }
