import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runNativeAcceptance} from './smoke.mjs';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const target=process.env.TOKENFLOW_BUNDLE_DIR || path.join(desktop,'src-tauri/target/release/bundle');
if(process.platform!=='darwin')throw new Error('On Windows run installer-smoke.mjs to test the installed bundle');
const temp=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-tauri-package-'));
try{
  const app=path.join(temp,'TokenFlow.app');await fs.cp(path.join(target,'macos/TokenFlow.app'),app,{recursive:true,verbatimSymlinks:true});
  await fs.access(path.join(app,'Contents/MacOS/tokenflow-collector'));
  process.env.TOKENFLOW_EXECUTABLE=path.join(app,'Contents/MacOS/tokenflow-desktop');
  await runNativeAcceptance();
}finally{await fs.rm(temp,{recursive:true,force:true});}
