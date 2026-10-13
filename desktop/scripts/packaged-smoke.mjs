import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = process.platform === 'win32'
  ? path.join(desktop,'release','win-unpacked','TokenFlow.exe')
  : path.join(desktop,'release',process.arch === 'arm64' ? 'mac-arm64' : 'mac','TokenFlow.app','Contents','MacOS','TokenFlow');
execFileSync(process.execPath,[path.join(desktop,'scripts','smoke.mjs')],{
  stdio:'inherit', env:{...process.env,TOKENFLOW_EXECUTABLE:executable},
});
