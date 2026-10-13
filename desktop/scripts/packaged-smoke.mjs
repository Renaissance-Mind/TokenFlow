import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32'
  ? path.join(desktop,'release','win-unpacked','TokenFlow.exe')
  : path.join(desktop,'release',process.arch === 'arm64' ? 'mac-arm64' : 'mac','TokenFlow.app','Contents','MacOS','TokenFlow');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-isolated-package-'));
const source = process.platform === 'win32' ? path.dirname(executable) : path.resolve(executable,'../../..');
const destination = path.join(temporary,process.platform === 'win32' ? 'TokenFlow' : 'TokenFlow.app');
try {
  await fs.cp(source,destination,{recursive:true,verbatimSymlinks:true});
  const isolatedExecutable = process.platform === 'win32' ? path.join(destination,'TokenFlow.exe') : path.join(destination,'Contents','MacOS','TokenFlow');
  const resources = process.platform === 'win32' ? path.join(destination,'resources') : path.join(destination,'Contents','Resources');
  for (const name of ['smol-toml','fzstd','proper-lockfile']) await fs.access(path.join(resources,'collector','node_modules',name,'package.json'));
  execFileSync(process.execPath,[path.join(desktop,'scripts','smoke.mjs')],{
    stdio:'inherit', env:{...process.env,TOKENFLOW_EXECUTABLE:isolatedExecutable},
  });
} finally { await fs.rm(temporary,{recursive:true,force:true}); }
