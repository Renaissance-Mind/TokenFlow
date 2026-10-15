import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CliClient} from '../app/cli-client.js';
import {collectorHome,findCli,inspectCli,installCli,rememberCli} from '../app/cli-installation.js';
const payload=path.resolve('collector');
test('reuses an installed CLI, preserves legacy config, and upgrades its existing terminal entrypoint',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-reuse-'));
  try{
    const bin=path.join(root,'bin'),pkg=path.join(root,'node_modules','@renaissancemind','tokenusage');
    await fs.mkdir(bin,{recursive:true});await fs.mkdir(path.join(pkg,'dist'),{recursive:true});
    await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'@renaissancemind/tokenusage',version:'0.1.8'}));
    await fs.writeFile(path.join(pkg,'dist','cli.js'),'#!/usr/bin/env node\n');
    if(process.platform!=='win32')await fs.symlink(path.join(pkg,'dist','cli.js'),path.join(bin,'tokenusage'));
    await fs.mkdir(path.join(root,'.tokenusage'),{recursive:true});
    const original=JSON.stringify({serverUrl:'https://example.com',deviceToken:'existing-token',deviceId:'existing-device'});
    await fs.writeFile(path.join(root,'.tokenusage','config.json'),original);
    assert.equal(await collectorHome(root,{}),path.join(root,'.tokenusage'));
    const options={home:root,env:{PATH:bin,TOKENFLOW_CLI_PATH:path.join(pkg,'dist','cli.js')},fallbackNode:process.execPath};
    const existing=await findCli(options);assert.equal(existing.source,'installed');assert.equal(existing.compatible,false);
    const upgraded=await installCli(payload,process.execPath,{home:root,env:{TOKENFLOW_DESKTOP_DATA:path.join(root,'app')},replace:existing});
    assert.equal(upgraded.entrypoint,existing.entrypoint);assert.equal(upgraded.compatible,true);
    assert.equal(await fs.readFile(path.join(root,'.tokenusage','config.json'),'utf8'),original);
    if(process.platform!=='win32') assert.equal((await fs.stat(upgraded.entrypoint)).mode & 0o111,0o111);
    const launched=await promisify(execFile)(upgraded.node,[upgraded.entrypoint,'--version']);
    assert.equal(launched.stdout.trim(),JSON.parse(await fs.readFile(path.join(payload,'package.json'),'utf8')).version);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('an App-installed CLI remains usable independently of App and reports local usage through real stdio',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-service-'));
  const old={...process.env};
  try{
    process.env.TOKENFLOW_HOME=path.join(root,'data');process.env.TOKENFLOW_DESKTOP_DATA=path.join(root,'app');process.env.TOKENFLOW_SCAN_HOME=path.join(root,'sources');
    await fs.mkdir(process.env.TOKENFLOW_SCAN_HOME,{recursive:true});
    const selected=await installCli(payload,process.execPath,{home:root,env:process.env});
    assert.equal(selected.node,process.execPath);assert.ok(!selected.entrypoint.startsWith(payload));
    const resolved=await findCli({home:root,env:process.env});assert.equal(resolved.entrypoint,selected.entrypoint);
    const client=new CliClient(selected);
    await client.request('configure',{serverUrl:'https://example.com',deviceName:'Shared CLI',paused:true});
    const auto=await promisify(execFile)(selected.node,[selected.entrypoint,'sync','--auto'],{env:process.env});
    assert.equal(auto.stdout,'');assert.equal((await client.request('state')).config.autoSyncPaused,true);
    assert.equal((await client.request('state')).config.deviceName,'Shared CLI');
    const phases=[],progress=[];const scan=await client.request('scan',{},phase=>phases.push(phase),value=>progress.push(value));
    assert.equal(progress[0].stage,'discovery');assert.equal(progress.at(-1).stage,'processing');
    assert.equal(progress.at(-1).percent,100);assert.equal(progress.at(-1).processedFiles,progress.at(-1).totalFiles);
    assert.equal(scan.summary.today.tokens,0);assert.deepEqual(phases,['scan']);
    assert.ok(scan.summary.sources.some(source=>source.agent==='codex'));
  }finally{process.env=old;await fs.rm(root,{recursive:true,force:true});}
});
test('CLI cancellation releases only its own sync lock and leaves authorization intact',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-cancel-'));const old={...process.env};
  try{
    process.env.TOKENFLOW_HOME=path.join(root,'data');process.env.TOKENFLOW_SCAN_HOME=path.join(root,'sources');
    await fs.mkdir(process.env.TOKENFLOW_HOME,{recursive:true});await fs.mkdir(process.env.TOKENFLOW_SCAN_HOME,{recursive:true});
    await fs.writeFile(path.join(process.env.TOKENFLOW_HOME,'config.json'),JSON.stringify({serverUrl:'https://example.com',deviceToken:'tu_dev_test',deviceId:'existing'}));
    const selected=await inspectCli(path.join(payload,'dist','cli.js'),process.execPath,'installed');
    const client=new CliClient(selected,async(_input,init)=>new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})));
    let pricing;const atPricing=new Promise(resolve=>{pricing=resolve;});
    const operation=client.request('sync',{},phase=>{if(phase==='pricing')pricing();});const stopped=assert.rejects(operation,/stopped/);
    await atPricing;await fs.access(path.join(process.env.TOKENFLOW_HOME,'sync.lock'));
    await client.stop();await stopped;
    await assert.rejects(fs.access(path.join(process.env.TOKENFLOW_HOME,'sync.lock')));
    assert.equal((await client.request('state')).config.deviceToken,'tu_dev_test');
    const scan=await client.request('scan');assert.equal(scan.summary.today.tokens,0);
  }finally{process.env=old;await fs.rm(root,{recursive:true,force:true});}
});
test('installing a global CLI after App makes both App and its terminal launcher select that CLI',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-install-order-'));
  try{
    const data=path.join(root,'data'),bin=path.join(root,'global-bin');
    const env={TOKENFLOW_HOME:data,TOKENFLOW_DESKTOP_DATA:path.join(root,'app'),PATH:bin};
    const managed=await installCli(payload,process.execPath,{home:root,env});
    const pkg=path.join(bin,'node_modules','@renaissancemind','tokenflow');
    await fs.mkdir(bin,{recursive:true});await fs.cp(payload,pkg,{recursive:true});
    const manifest=JSON.parse(await fs.readFile(path.join(pkg,'package.json'),'utf8'));
    const [major,minor,patch]=manifest.version.split('.').map(Number),globalVersion=`${major}.${minor}.${patch+1}`;
    manifest.version=globalVersion;
    await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify(manifest));
    if(process.platform!=='win32')await fs.symlink(path.join(pkg,'dist','cli.js'),path.join(bin,'tokenflow'));
    const selected=await findCli({home:root,env:{TOKENFLOW_HOME:data,PATH:bin},fallbackNode:process.execPath});
    assert.equal(selected.source,'installed');assert.equal(selected.version,globalVersion);assert.notEqual(selected.entrypoint,managed.entrypoint);
    await rememberCli(selected,root,env);
    const result=await promisify(execFile)(process.execPath,[path.join(data,'cli-launcher.mjs'),'--version']);
    assert.equal(result.stdout.trim(),globalVersion);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
