import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const collector = path.join(desktop, 'collector');
await fs.access(path.join(desktop, 'dashboard/index.html'));
for (const name of ['progress.js','progress.css','window-chrome.js','window-chrome.css']) await fs.copyFile(path.join(desktop,'renderer',name),path.join(desktop,'dashboard',name));
await fs.rm(collector, { recursive: true, force: true });
await fs.mkdir(collector, { recursive: true });
await fs.cp(path.join(root, 'dist'), path.join(collector, 'dist'), { recursive: true });
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
await fs.writeFile(path.join(collector, 'package.json'), JSON.stringify({ ...pkg, scripts: undefined, devDependencies: undefined }));
const copied = new Set();
async function copyDependency(name) {
  if (copied.has(name)) return;
  copied.add(name);
  const source = path.join(root, 'node_modules', name);
  await fs.cp(source, path.join(collector, 'node_modules', name), { recursive: true });
  const dependency = JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8'));
  for (const child of Object.keys(dependency.dependencies || {})) await copyDependency(child);
}
for (const name of Object.keys(pkg.dependencies)) await copyDependency(name);
await fs.cp(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(collector, 'THIRD_PARTY_NOTICES.md'));
const assets = path.join(desktop, 'assets');
await fs.mkdir(assets, { recursive: true });
const symbol = `<path d="M32 17a15 15 0 1 0 15 15" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M32 25a7 7 0 1 0 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="47" cy="17" r="4" fill="currentColor"/>`;
const svg = (size, color, background = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" color="${color}">${background}${symbol}</svg>`;
await sharp(Buffer.from(svg(1024, '#8bd8cd', '<rect width="64" height="64" rx="14" fill="#0b0e15"/>'))).png().toFile(path.join(assets, 'icon.png'));
await sharp(Buffer.from(svg(32, '#8bd8cd'))).png().toFile(path.join(assets, 'tray.png'));
await sharp(Buffer.from(svg(22, '#000000'))).png().toFile(path.join(assets, 'trayTemplate.png'));
await sharp(Buffer.from(svg(44, '#000000'))).png().toFile(path.join(assets, 'trayTemplate@2x.png'));
console.log(`Bundled collector ${pkg.version} with ${copied.size} runtime dependencies.`);
