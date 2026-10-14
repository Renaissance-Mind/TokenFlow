// Snapshot the canonical web Dashboard and its assets for offline use. Normal
// App builds use this checked-in snapshot and do not require the server checkout.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const server=path.resolve(process.argv[2] || path.join(desktop,'../../TokenFlow_Server'));
const require=createRequire(path.join(server,'package.json'));
const {build}=require('esbuild');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-dashboard-'));
try {
  const module=path.join(temporary,'dashboard.mjs');
  await build({entryPoints:[path.join(server,'src/html.ts')],bundle:true,platform:'node',format:'esm',outfile:module});
  const {dashboardHtml}=await import(pathToFileURL(module));
  let html=dashboardHtml();
  // All API calls go through a narrow data adapter. The page and chart code
  // remain the same when the adapter changes between local and synced data.
  html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
  html=html.replaceAll('https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.20.1/cdn/','/vendor/shoelace/');
  html=html.replace('<body>','<body>\n<section class="operation-progress" id="operationProgress" hidden aria-live="polite"><span id="progressLabel"></span><div class="progress-track" id="progressTrack" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span class="progress-fill" id="progressFill"></span></div><span id="progressPercent"></span></section>\n<header class="desktop-toolbar"><strong>Dashboard</strong><span id="desktopDataSource"></span><span id="desktopActivity" role="status"></span><button id="desktopRefresh" type="button">Refresh</button><button id="desktopSync" type="button">Sync</button><button id="desktopSettings" type="button">Settings</button></header>');
  html=html.replace('function api(path, options = {}) {','function api(path, options = {}) {\n      if (window.tokenflow) return window.tokenflow.dashboardRequest(path, options);');
  html=html.replace('if (!previewMode && !snapshotMode) await loadApiKeys();','if (!window.tokenflow && !previewMode && !snapshotMode) await loadApiKeys();');
  html=html.replace('function scheduleWidgetPreviewPrefetch() {','function scheduleWidgetPreviewPrefetch() {\n      if (window.tokenflow) return;');
  html=html.replace('const action = previewMode','const action = (previewMode || window.tokenflow)');
  html=html.replace('    boot();','    window.tokenflowDashboard = { boot, refresh: async () => { apiReadRequests.clear(); usageHeatmapCache.clear(); hourlyCache.clear(); await boot(); }, language: applyLanguage };');
  html=html.replace('</head>','<link rel="stylesheet" href="/desktop.css"><link rel="stylesheet" href="/progress.css"></head>');
  html=html.replace('</body>','<script type="module" src="/desktop.js"></script></body>');
  const destination=path.join(desktop,'dashboard');await fs.mkdir(destination,{recursive:true});
  await fs.writeFile(path.join(destination,'index.html'),html);
  for(const name of ['personas','vendor'])await fs.cp(path.join(server,'public',name),path.join(destination,name),{recursive:true});
  await fs.writeFile(path.join(destination,'source.json'),JSON.stringify({source:'TokenFlow_Server/src/html.ts:dashboardHtml',sha256:createHash('sha256').update(dashboardHtml()).digest('hex')},null,2)+'\n');
  console.log('Bundled the canonical Dashboard and its offline chart/persona assets.');
} finally {await fs.rm(temporary,{recursive:true,force:true});}
