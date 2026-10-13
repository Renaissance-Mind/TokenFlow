import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runNativeAcceptance} from './smoke.mjs';
if(process.platform!=='win32')throw new Error('Run the EXE installation check on Windows');
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const folder=path.join(desktop,'src-tauri/target/release/bundle/nsis');
const setup=(await fs.readdir(folder)).find(name=>name.endsWith('.exe'));
if(!setup)throw new Error('Build the Windows installer first');
const destination=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-tauri-installed-'));
try{
  execFileSync(path.join(folder,setup),['/S','/D='+destination],{stdio:'inherit',timeout:120_000});
  process.env.TOKENFLOW_EXECUTABLE=path.join(destination,'tokenflow-desktop.exe');
  await fs.access(path.join(destination,'tokenflow-collector.exe'));
  await runNativeAcceptance({TOKENFLOW_SYSTEM_TEST:'1'});
  console.log('Tauri NSIS installer and standalone collector passed.');
}finally{execFileSync(path.join(destination,'uninstall.exe'),['/S'],{stdio:'inherit',timeout:120_000});}
