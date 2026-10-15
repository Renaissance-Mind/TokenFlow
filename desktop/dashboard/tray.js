// The popup uses the canonical Dashboard nodes, chart renderers and API broker.
// Keep the other nodes in an inert archive because those renderers also update
// their auxiliary labels; no separate usage calculations live in the tray.
import {renderProgress} from './progress.js';
document.body.classList.add('mini-dashboard');
const $=id=>document.getElementById(id);
const main=document.querySelector('main');
const widgets={overview:document.querySelector('.summary-board'),trend:$('dailyTrend').closest('.panel'),models:$('modelShare').closest('.panel'),activity:$('usageHeatmap').closest('.panel')};
const archive=document.createElement('div');archive.hidden=true;archive.inert=true;archive.id='miniArchive';
while(main.firstChild)archive.append(main.firstChild);
main.append(archive);
const content=document.createElement('div');content.id='miniWidgets';
for(const [name,node] of Object.entries(widgets)){node.dataset.miniWidget=name;content.append(node);}
main.append(content);
const progress=$('operationProgress');
document.querySelector('.desktop-toolbar').outerHTML=`<header class="mini-header">
  <div class="mini-title"><svg class="mini-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 17a15 15 0 1 0 15 15" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M32 25a7 7 0 1 0 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="47" cy="17" r="4" fill="currentColor"/></svg><strong>Dashboard</strong><button id="miniSettings" class="mini-settings" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m9 3-.6 2.4-2 .9-2.2-.7-2 3.4 1.6 1.7v2.6L2.2 15l2 3.4 2.2-.7 2 .9L9 21h4l.6-2.4 2-.9 2.2.7 2-3.4-1.6-1.7v-2.6L19.8 9l-2-3.4-2.2.7-2-.9L13 3Z" transform="translate(1 0)"/><circle cx="12" cy="12" r="3"/></svg></button></div>
  <div class="mini-context"><span id="miniSource"></span><div class="mini-ranges" role="group" aria-label="Time range"><button data-mini-range="1">Today</button><button data-mini-range="7">7D</button><button data-mini-range="30">30D</button></div></div>
</header>`;
const footer=document.createElement('footer');footer.className='mini-footer';footer.innerHTML=`<div class="mini-status"><span id="miniNotice" role="status"></span></div><nav class="mini-actions" aria-label="Dashboard actions"><button id="miniRefresh">Refresh</button><button id="miniSync">Sync</button><button id="trayDashboard">Open Dashboard <span aria-hidden="true">↗</span></button></nav>`;
document.body.append(footer);footer.querySelector('.mini-status').append(progress);
let latest,revision='',running=false,pending=false,started=false,lastHeight=0;
const media=matchMedia('(prefers-color-scheme: dark)');
const words={en:{local:'This device',cloud:'Synced data',today:'Today',settings:'Customize popup',refresh:'Refresh',sync:'Sync',open:'Open Dashboard ↗',updated:'Updated',loading:'Loading Dashboard…'},zh:{local:'本机数据',cloud:'同步数据',today:'今日',settings:'设置小窗',refresh:'刷新',sync:'同步',open:'打开 Dashboard ↗',updated:'更新于',loading:'正在读取 Dashboard…'}};
function resize(){
  const height=Math.ceil(document.querySelector('.mini-header').getBoundingClientRect().height+main.getBoundingClientRect().height+footer.getBoundingClientRect().height);
  if(Math.abs(height-lastHeight)>1){lastHeight=height;void window.tokenflow.resizeTray(height);}
}
function theme(){
  if(!latest)return;
  const value=latest.settings.trayTheme;
  const resolved=value==='system'?(media.matches?'dark':'light'):value;
  if(document.documentElement.dataset.theme===resolved)return;
  document.documentElement.dataset.theme=resolved;
  window.tokenflowDashboard.repaint();
}
async function refresh(){
  if(running){pending=true;return;}running=true;
  document.body.dataset.miniLoaded='false';
  try{if(!started){started=true;await window.tokenflowDashboard.boot();}else await window.tokenflowDashboard.refresh();
    document.body.dataset.miniLoaded='true';
    $('miniNotice').textContent=(words[latest.settings.language]||words.en).updated+' '+new Date().toLocaleTimeString(latest.settings.language==='zh'?'zh-CN':'en',{hour:'2-digit',minute:'2-digit'});
  }catch(error){$('miniNotice').textContent=error.message;}
  finally{running=false;resize();if(pending){pending=false;void refresh();}}
}
function update(state){
  latest=state;const t=words[state.settings.language]||words.en;
  window.tokenflowMini={range:state.settings.trayRange,widgets:state.settings.trayWidgets,needsHeatmap:state.settings.trayWidgets.some(name=>name!=='models')};
  for(const [name,node] of Object.entries(widgets))node.hidden=!state.settings.trayWidgets.includes(name);
  $('miniSource').textContent=t[state.dashboardSource];
  $('miniSettings').title=t.settings;$('miniSettings').setAttribute('aria-label',t.settings);
  $('miniRefresh').textContent=t.refresh;$('miniSync').textContent=t.sync;$('trayDashboard').textContent=t.open;
  document.querySelector('[data-mini-range="1"]').textContent=t.today;
  for(const button of document.querySelectorAll('[data-mini-range]'))button.setAttribute('aria-pressed',String(Number(button.dataset.miniRange)===state.settings.trayRange));
  $('miniRefresh').disabled=!!state.busy||!state.cli.compatible;
  $('miniSync').disabled=!!state.busy||!state.hasCollector||!state.cli.compatible;
  renderProgress(state);$('miniNotice').hidden=!progress.hidden;
  const key=JSON.stringify([state.dashboardSource,state.summary?.scannedAt,state.settings.serverUrl,state.account?.id,state.lastSyncAt,state.settings.trayRange,state.settings.trayWidgets,state.settings.language]);
  if(key!==revision){revision=key;window.tokenflowDashboard.language(state.settings.language);window.tokenflowDashboard.miniRange(state.settings.trayRange);theme();if(!started)$('miniNotice').textContent=t.loading;void refresh();}
  else theme();
  resize();
}
$('miniSettings').onclick=()=>window.tokenflow.openSettings('tray');
$('trayDashboard').onclick=()=>window.tokenflow.dashboard();
$('miniRefresh').onclick=async()=>{if(latest.dashboardSource==='local')await window.tokenflow.scan();await refresh();};
$('miniSync').onclick=async()=>{await window.tokenflow.sync();await refresh();};
for(const button of document.querySelectorAll('[data-mini-range]'))button.onclick=()=>window.tokenflow.saveSettings({trayRange:Number(button.dataset.miniRange)});
media.addEventListener('change',theme);
new ResizeObserver(resize).observe(main);
window.tokenflow.onState(update);window.tokenflow.getState().then(update);
