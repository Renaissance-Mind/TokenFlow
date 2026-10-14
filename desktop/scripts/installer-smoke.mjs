import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Run the EXE installation check on Windows');
const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const release = path.join(desktop,'release');
const setup = (await fs.readdir(release)).find((name) => /^TokenFlow-.+-win-x64\.exe$/.test(name));
if (!setup) throw new Error('Build the Windows installer first');
const destination = await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-installed-'));
try {
  execFileSync(path.join(release,setup),['/S','/D='+destination],{stdio:'inherit',timeout:120_000});
  const executable = path.join(destination,'TokenFlow.exe');
  await fs.access(executable);
  await fs.access(path.join(destination,'resources','collector','dist','cli.js'));
  execFileSync(process.execPath,[path.join(desktop,'scripts','smoke.mjs')],{
    stdio:'inherit',env:{...process.env,TOKENFLOW_EXECUTABLE:executable,TOKENFLOW_SYSTEM_TEST:'1'},timeout:120_000,
  });
  console.log('Windows EXE installed successfully with its bundled collector and runtime.');
} finally {
  const uninstall = path.join(destination,'Uninstall TokenFlow.exe');
  if (await fs.stat(uninstall).then(() => true).catch((error) => { if (error.code === 'ENOENT') return false; throw error; })) {
    execFileSync(uninstall,['/S'],{stdio:'inherit',timeout:120_000});
  }
}
