// electron-builder invokes this for each target architecture. Ship an official,
// checksummed Node runtime, never a Homebrew binary with machine-local libraries.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { Arch } = require('builder-util');
module.exports = async (context) => {
  const version = '24.21.0';
  const arch = Arch[context.arch];
  const platform = context.electronPlatformName;
  if (!['darwin', 'win32'].includes(platform)) throw new Error('Unsupported desktop platform');
  const target = path.join(context.packager.info.appDir, `node-${arch}`);
  const filename = platform === 'win32' ? 'node.exe' : 'node';
  if (await fs.readFile(path.join(target, 'VERSION'), 'utf8').catch(() => '') === version && await fs.access(path.join(target, filename)).then(() => true).catch(() => false)) return;
  const stem = `node-v${version}-${platform === 'win32' ? 'win' : 'darwin'}-${arch}`;
  const archive = `${stem}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
  const base = `https://nodejs.org/dist/v${version}/`;
  const sumsResponse = await fetch(base + 'SHASUMS256.txt');
  if (!sumsResponse.ok) throw new Error('Unable to read Node runtime checksums');
  const sums = await sumsResponse.text();
  const expected = sums.split('\n').find((line) => line.trim().endsWith(`  ${archive}`))?.split(/\s+/)[0];
  if (!expected) throw new Error('Node runtime is missing its checksum');
  const response = await fetch(base + archive);
  if (!response.ok) throw new Error('Unable to download standalone Node runtime');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (crypto.createHash('sha256').update(buffer).digest('hex') !== expected) throw new Error('Node runtime checksum mismatch');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-node-'));
  try {
    const file = path.join(temp, archive); await fs.writeFile(file, buffer);
    if (platform === 'win32') await require('extract-zip')(file, { dir: temp });
    else execFileSync('tar', ['-xzf', file, '-C', temp]);
    await fs.mkdir(target, { recursive: true });
    await fs.copyFile(path.join(temp, stem, platform === 'win32' ? filename : 'bin/node'), path.join(target, filename));
    await fs.chmod(path.join(target, filename), 0o755);
    await fs.copyFile(path.join(temp, stem, 'LICENSE'), path.join(target, 'LICENSE'));
    await fs.writeFile(path.join(target, 'VERSION'), version);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
};
