import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-brand.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(desktop, '..');
const collector = path.join(desktop, 'collector');
await fs.access(path.join(desktop, 'dashboard/index.html'));
for (const name of ['progress.js','progress.css','window-chrome.js','window-chrome.css']) await fs.copyFile(path.join(desktop,'renderer',name),path.join(desktop,'dashboard',name));
const dashboardHtml=await fs.readFile(path.join(desktop,'dashboard/index.html'),'utf8');
const chartVendor=dashboardHtml.match(/src="\/vendor\/(echarts-[^"]+\.js)"/)[1];
await fs.mkdir(path.join(desktop,'renderer/vendor'),{recursive:true});
await fs.copyFile(path.join(desktop,'dashboard/vendor',chartVendor),path.join(desktop,'renderer/vendor/echarts.js'));
await fs.copyFile(path.join(desktop,'renderer/widget-catalog.js'),path.join(desktop,'dashboard/widget-catalog.js'));
await fs.cp(path.join(desktop,'renderer/icons'),path.join(desktop,'dashboard/editor-icons'),{recursive:true});
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
await fs.copyFile(path.join(root, 'LICENSE'), path.join(collector, 'LICENSE'));
await fs.copyFile(path.join(root, 'LICENSE'), path.join(desktop, 'LICENSE'));
console.log(`Bundled collector ${pkg.version} with ${copied.size} runtime dependencies.`);
