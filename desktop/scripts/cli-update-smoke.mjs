// Real npm packages, real App IPC, isolated data; no registry or updater stubs.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-npm-update-smoke-'));
const npm = path.join(desktop, 'node_modules/npm/bin/npm-cli.js');
let instance;
try {
  await execute(process.execPath, [npm, 'install', '--prefix', temp, '--registry=https://registry.npmjs.org', '--ignore-scripts', '--install-strategy=nested', '--no-audit', '--no-fund', '@renaissancemind/tokenflow@0.2.81'], {timeout:180_000});
  const entry = path.join(temp, 'node_modules/@renaissancemind/tokenflow/dist/cli.js');
  const data = path.join(temp, 'data'); await fs.mkdir(data);
  const config = { serverUrl:'https://tokenflow.renaissancemind.ai', deviceId:'isolated-update-smoke', deviceName:'CLI update smoke', autoSyncPaused:true };
  await fs.writeFile(path.join(data, 'config.json'), JSON.stringify(config));
  const env = {...process.env, TOKENFLOW_HOME:data, TOKENUSAGE_HOME:data, TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'), TOKENFLOW_SCAN_HOME:path.join(temp,'empty'), TOKENFLOW_CLI_PATH:entry, TOKENFLOW_NODE_PATH:process.execPath};
  delete env.ELECTRON_RUN_AS_NODE;
  await fs.mkdir(env.TOKENFLOW_SCAN_HOME);
  const executablePath = process.env.TOKENFLOW_EXECUTABLE || (process.argv.includes('--packaged')
    ? path.join(desktop,'release',process.platform==='win32'?'win-unpacked':process.arch==='arm64'?'mac-arm64':'mac',process.platform==='win32'?'TokenFlow.exe':'TokenFlow.app/Contents/MacOS/TokenFlow') : undefined);
  if (executablePath) delete env.TOKENFLOW_NODE_PATH;
  instance = await electron.launch({args:executablePath?[]:[desktop], ...(executablePath?{executablePath}:{}), env, timeout:60_000});
  const page = await instance.firstWindow();
  await page.waitForURL(/mode=dashboard$/);
  await page.waitForFunction(()=>!!window.tokenflow);
  await page.evaluate(() => window.tokenflow.openSettings());
  let settings;
  for (let i=0;i<100;i++) {
    settings=instance.windows().find(w=>w.url().includes('mode=settings'));
    if(settings)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(settings, 'Settings window opened');
  const before = await settings.evaluate(()=>window.tokenflow.getState());
  assert.equal(before.cli.version,'0.2.81');
  await settings.evaluate(()=>window.tokenflow.checkCliUpdate());
  const checked = await settings.evaluate(()=>window.tokenflow.getState());
  assert.equal(checked.cli.updateStatus,'available');
  await settings.evaluate(()=>window.tokenflow.upgradeCli());
  const after = await settings.evaluate(()=>window.tokenflow.getState());
  assert.equal(after.cli.version,checked.cli.availableVersion);
  assert.equal(after.cli.updateStatus,'current'); assert.equal(after.error,null);
  assert.equal(after.cli.path,before.cli.path,'Existing terminal path preserved');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(data,'config.json'),'utf8')),config,'Configuration preserved');
  await instance.close(); instance=null;
  const run = await execute(process.execPath,[entry,'--version']);
  assert.equal(run.stdout.trim(),after.cli.version,'Terminal works after App quits and temporary download is removed');
  // Exercise imports of runtime dependencies as well as --version.
  const response = execFileSync(process.execPath,[entry,'desktop-service'],{env,input:JSON.stringify({action:'state',params:{}})+'\n',encoding:'utf8',timeout:30_000});
  assert.ok(response.split('\n').some(line=>line && JSON.parse(line).type==='result'));
  console.log(JSON.stringify({before:before.cli.version,after:after.cli.version,terminalPathPreserved:true,configurationPreserved:true,appVersion:after.version}));
} finally { if(instance)await instance.close(); await fs.rm(temp,{recursive:true,force:true}); }
