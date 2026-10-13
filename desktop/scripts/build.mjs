import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import sharp from 'sharp';

const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.dirname(desktop);
const version='26.5.0';
const target=process.env.TOKENFLOW_TARGET || `${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-${process.platform === 'darwin' ? 'apple-darwin' : process.platform === 'win32' ? 'pc-windows-msvc' : 'unknown-linux-gnu'}`;
const arch=target.startsWith('aarch64')?'arm64':'x64';
const platform=target.includes('apple')?'darwin':target.includes('windows')?'win':'linux';
const hostPlatform=process.platform === 'win32'?'win':process.platform;
const work=path.join(desktop,'build');
await fs.mkdir(work,{recursive:true});
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',['run','build'],{cwd:root,stdio:'inherit',shell:process.platform === 'win32'});
await build({entryPoints:[path.join(desktop,'src/service.ts')],outfile:path.join(work,'collector.cjs'),bundle:true,platform:'node',target:'node26',format:'cjs',minify:true,define:{'import.meta.url':'undefined'},logLevel:'warning'});
await build({entryPoints:[path.join(desktop,'src/bridge.ts')],outfile:path.join(desktop,'renderer/bridge.js'),bundle:true,platform:'browser',format:'iife',target:'safari15',minify:true});
for(const name of ['auth','summary','sqlite'])await build({entryPoints:[path.join(desktop,'src',name+'.ts')],outfile:path.join(desktop,'app',name+'.js'),platform:'node',format:'esm',target:'node24'});
const symbol=`<path d="M32 17a15 15 0 1 0 15 15" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M32 25a7 7 0 1 0 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="47" cy="17" r="4" fill="currentColor"/>`;
const svg=(size,color,background='')=>`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" color="${color}">${background}${symbol}</svg>`;
await fs.mkdir(path.join(desktop,'assets'),{recursive:true});
await sharp(Buffer.from(svg(1024,'#8bd8cd','<rect width="64" height="64" rx="14" fill="#0b0e15"/>'))).png().toFile(path.join(desktop,'assets/icon.png'));
await sharp(Buffer.from(svg(44,'#000000'))).png().toFile(path.join(desktop,'assets/trayTemplate.png'));
await sharp(Buffer.from(svg(32,'#8bd8cd'))).png().toFile(path.join(desktop,'assets/tray.png'));
execFileSync(process.platform === 'win32'?'npm.cmd':'npm',['exec','tauri','icon','assets/icon.png','--','--output','src-tauri/icons'],{cwd:desktop,stdio:'inherit',shell:process.platform === 'win32'});

async function download(url,file){
  if(await fs.stat(file).then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error;}))return;
  const temp=file+'.download';
  execFileSync('curl',['--fail','--location','--retry','3','--connect-timeout','20','--max-time','180',url,'--output',temp],{stdio:'inherit'});
  await fs.rename(temp,file);
}
async function nodeBinary(osName,cpu){
  const folder=`node-v${version}-${osName}-${cpu}`;const extension=osName === 'win'?'zip':'tar.gz';
  const archive=path.join(work,folder+'.'+extension);
  await download(`https://nodejs.org/dist/v${version}/${folder}.${extension}`,archive);
  const sums=path.join(work,`SHASUMS-${version}.txt`);await download(`https://nodejs.org/dist/v${version}/SHASUMS256.txt`,sums);
  const expected=(await fs.readFile(sums,'utf8')).split('\n').find(line=>line.endsWith(`${folder}.${extension}`))?.split(/\s+/)[0];
  const actual=createHash('sha256').update(await fs.readFile(archive)).digest('hex');if(!expected || actual!==expected)throw new Error('Node runtime checksum mismatch');
  const executable=path.join(work,folder,osName === 'win'?'node.exe':'bin/node');
  if(!await fs.stat(executable).then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error;})){
    if(osName === 'win')execFileSync('powershell.exe',['-NoProfile','-Command',`Expand-Archive -LiteralPath '${archive.replaceAll("'","''")}' -DestinationPath '${work.replaceAll("'","''")}' -Force`],{stdio:'inherit'});
    else execFileSync('tar',['-xzf',archive,'-C',work],{stdio:'inherit'});
  }
  return executable;
}
const host=await nodeBinary(hostPlatform,process.arch);
const runtime=await nodeBinary(platform,arch);
const binaries=path.join(desktop,'src-tauri/binaries');await fs.mkdir(binaries,{recursive:true});
const output=path.join(binaries,`tokenflow-collector-${target}${platform === 'win'?'.exe':''}`);
const licenses=path.join(work,'licenses');await fs.mkdir(licenses,{recursive:true});
await fs.copyFile(path.join(platform === 'win'?path.dirname(runtime):path.dirname(path.dirname(runtime)),'LICENSE'),path.join(licenses,'Node-LICENSE'));
const metadata=JSON.parse(execFileSync('cargo',['metadata','--manifest-path',path.join(desktop,'src-tauri/Cargo.toml'),'--locked','--format-version','1','--filter-platform',target],{encoding:'utf8',maxBuffer:20_000_000}));
for(const pkg of metadata.packages){
  const folder=path.dirname(pkg.manifest_path);const files=await fs.readdir(folder);
  for(const name of files.filter(name=>/^(LICENSE|COPYING|NOTICE)(\.|-|$)/i.test(name))){const file=path.join(folder,name);if((await fs.stat(file)).isFile())await fs.copyFile(file,path.join(licenses,`${pkg.name}-${pkg.version}-${name}`));}
}
for(const name of ['proper-lockfile','proper-lockfile/node_modules/signal-exit','retry','signal-exit','graceful-fs','fzstd','smol-toml']){
  const folder=path.join(root,'node_modules',name);for(const file of await fs.readdir(folder)){if(/^LICEN[SC]E/i.test(file) && (await fs.stat(path.join(folder,file))).isFile())await fs.copyFile(path.join(folder,file),path.join(licenses,name.replaceAll('/','-')+'-'+file));}
}
const config={main:path.join(work,'collector.cjs'),mainFormat:'commonjs',executable:runtime,output,disableExperimentalSEAWarning:true,useSnapshot:false,useCodeCache:false,execArgv:['--no-warnings'],execArgvExtension:'none'};
const configPath=path.join(work,'sea.json');await fs.writeFile(configPath,JSON.stringify(config));
// Node 26's built-in Mach-O SEA writer currently produces crashing x64 binaries.
// The documented blob/postject route preserves the Intel executable layout.
if(platform === 'darwin' && arch === 'x64'){
  const blob=path.join(work,'collector.blob');const blobConfig={...config,output:blob};delete blobConfig.executable;
  await fs.writeFile(configPath,JSON.stringify(blobConfig));
  execFileSync(runtime,['--experimental-sea-config',configPath],{stdio:'inherit'});
  await fs.copyFile(runtime,output);execFileSync('codesign',['--remove-signature',output]);
  execFileSync(process.execPath,[path.join(desktop,'node_modules/postject/dist/cli.js'),output,'NODE_SEA_BLOB',blob,'--sentinel-fuse','NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2','--macho-segment-name','NODE_SEA'],{stdio:'inherit'});
}else execFileSync(host,['--build-sea',configPath],{stdio:'inherit'});
if(platform !== 'win')await fs.chmod(output,0o755);
if(platform === 'darwin'){
  if(arch !== 'x64')execFileSync('codesign',['--remove-signature',output]);
  execFileSync('strip',['-S','-x',output]);
  execFileSync('codesign',['--force','--sign','-',output],{stdio:'inherit'});
}
console.log(`Standalone collector built for ${target}: ${(await fs.stat(output)).size/1e6} MB.`);
