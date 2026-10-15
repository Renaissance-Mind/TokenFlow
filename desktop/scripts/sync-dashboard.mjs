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
  // Fail loudly when the web page changes an integration point. A silent
  // replacement would otherwise ship a page that bypasses the CLI adapter.
  function replaceOnce(before, after) {
    if (html.split(before).length !== 2) throw new Error(`Dashboard integration point changed: ${before}`);
    html=html.replace(before,after);
  }
  // All API calls go through a narrow data adapter. The page and chart code
  // remain the same when the adapter changes between local and synced data.
  html=html.replace('<head>','<head>\n<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; object-src \'none\'; base-uri \'none\'; form-action \'none\'">');
  html=html.replace(/  <link rel="preconnect"[^>]+>\n/g,'');
  replaceOnce('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap','/vendor/inter/wght.css');
  const chartUrl=html.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/echarts@([^/]+)\/dist\/echarts\.min\.js/);
  const chartPackage=require('echarts/package.json');
  if (!chartUrl || chartUrl[1] !== chartPackage.version) throw new Error('Install the web Dashboard\'s exact ECharts version before snapshotting.');
  const chart=await fs.readFile(path.join(server,'node_modules/echarts/dist/echarts.min.js'));
  const chartFile=`echarts-${createHash('sha256').update(chart).digest('hex').slice(0,12)}.js`;
  replaceOnce(chartUrl[0],'/vendor/'+chartFile);
  replaceOnce('<body>','<body>\n'+await fs.readFile(path.join(desktop,'dashboard/toolbar.html'),'utf8'));
  replaceOnce('async function api(path, options = {}) {','async function api(path, options = {}) {\n      if (window.tokenflow) return window.tokenflow.dashboardRequest(path, options);');
  replaceOnce('if (!previewMode && !snapshotMode) await loadApiKeys();','if (!window.tokenflow && !previewMode && !snapshotMode) await loadApiKeys();');
  replaceOnce('function scheduleWidgetPreviewPrefetch() {','function scheduleWidgetPreviewPrefetch() {\n      if (window.tokenflow) return;');
  replaceOnce('const action = previewMode','const action = (previewMode || window.tokenflow)');
  replaceOnce('loadTbti();\n      await loadDeviceFilters();','if (!window.tokenflowMini) loadTbti();\n      await loadDeviceFilters();');
  replaceOnce('const fixedWidgetsPromise = options.refreshFixedWidgets === false','const fixedWidgetsPromise = options.refreshFixedWidgets === false || (window.tokenflowMini && !window.tokenflowMini.needsHeatmap)');
  replaceOnce('const hourlyPromise = options.refreshFixedWidgets === false','const hourlyPromise = options.refreshFixedWidgets === false || !!window.tokenflowMini');
  replaceOnce('const element = document.getElementById(elementId);\n      if (!window.echarts)', 'const element = document.getElementById(elementId);\n      if (window.tokenflowMini && (!element.clientWidth || !element.clientHeight)) return currentChart;\n      if (!window.echarts)');
  replaceOnce('function renderDailyTrend(payload, options = {}) {','function renderDailyTrend(payload, options = {}) {\n      if (window.tokenflowMini && !window.tokenflowMini.widgets.includes("trend")) return;');
  replaceOnce('    boot();',`    window.tokenflowDashboard = { boot, refresh: async () => { usageHeatmapCache.clear(); hourlyCache.clear(); await boot(); }, language: applyLanguage,
      miniRange: days => { selectedTrendDays = days; dashboardAllRange = false; const to = today.toISOString().slice(0, 10); document.getElementById('from').value = rangeStartDate(to, days); document.getElementById('to').value = to; }, repaint: refreshThemeSensitiveViews };`);
  html=html.replace('</head>','<link rel="stylesheet" href="/desktop.css"><link rel="stylesheet" href="/progress.css"><link rel="stylesheet" href="/window-chrome.css"><link rel="stylesheet" href="/tray.css"></head>');
  html=html.replace('</body>','<script type="module" src="/desktop.js"></script></body>');
  const destination=path.join(desktop,'dashboard');await fs.mkdir(destination,{recursive:true});
  await fs.writeFile(path.join(destination,'index.html'),html);
  for(const name of ['personas','identity-share']) {
    await fs.rm(path.join(destination,name),{recursive:true,force:true});
    await fs.cp(path.join(server,'public',name),path.join(destination,name),{recursive:true});
  }
  const vendor=path.join(destination,'vendor');
  await fs.rm(vendor,{recursive:true,force:true});await fs.mkdir(vendor,{recursive:true});
  await fs.writeFile(path.join(vendor,chartFile),chart);
  for(const [source,name] of [['echarts/LICENSE','echarts-LICENSE.txt'],['echarts/NOTICE','echarts-NOTICE.txt'],['zrender/LICENSE','zrender-LICENSE.txt']])await fs.copyFile(path.join(server,'node_modules',source),path.join(vendor,name));
  const inter=path.join(desktop,'node_modules/@fontsource-variable/inter');
  const fonts=path.join(vendor,'inter');await fs.mkdir(path.join(fonts,'files'),{recursive:true});
  const fontCss=(await fs.readFile(path.join(inter,'wght.css'),'utf8')).replaceAll("'Inter Variable'","'Inter'");
  for(const [,file] of fontCss.matchAll(/url\(\.\/files\/([^)]*)\)/g))await fs.copyFile(path.join(inter,'files',file),path.join(fonts,'files',file));
  await fs.writeFile(path.join(fonts,'wght.css'),fontCss);
  await fs.copyFile(path.join(inter,'LICENSE'),path.join(fonts,'LICENSE.txt'));
  await fs.writeFile(path.join(destination,'source.json'),JSON.stringify({source:'TokenFlow_Server/src/html.ts:dashboardHtml',sha256:createHash('sha256').update(dashboardHtml()).digest('hex'),echarts:chartPackage.version,inter:JSON.parse(await fs.readFile(path.join(inter,'package.json'),'utf8')).version},null,2)+'\n');
  console.log('Bundled the canonical Dashboard and its offline chart/persona assets.');
} finally {await fs.rm(temporary,{recursive:true,force:true});}
