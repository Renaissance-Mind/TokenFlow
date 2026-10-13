import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function runNativeAcceptance(extra={},phase='basic'){
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-tauri-'));
  const report=extra.TOKENFLOW_ACCEPTANCE_REPORT || path.join(temp,'report.json');
  await fs.rm(report,{force:true});
  const executable=process.env.TOKENFLOW_EXECUTABLE || path.join(desktop,'src-tauri/target/release',process.platform==='win32'?'tokenflow-desktop.exe':'tokenflow-desktop');
  const env={...process.env,TOKENFLOW_HOME:path.join(temp,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(temp,'app'),TOKENFLOW_SCAN_HOME:path.join(temp,'sources'),TOKENFLOW_ACCEPTANCE_REPORT:report,TOKENFLOW_ACCEPTANCE_PHASE:phase,...extra};
  await fs.mkdir(env.TOKENFLOW_SCAN_HOME,{recursive:true});
  let output='';const child=spawn(executable,[],{env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const timeout=setTimeout(()=>child.kill(),100_000);
  try{
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});
    const result=JSON.parse(await fs.readFile(report,'utf8').catch(error=>{throw new Error(`No native acceptance report: ${error.message}\n${output}`);}));
    assert.equal(result.ok,true,JSON.stringify(result)+'\n'+output);assert.equal(code,0,output);console.log(JSON.stringify(result));return result;
  }finally{clearTimeout(timeout);child.kill();await fs.rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runNativeAcceptance();
