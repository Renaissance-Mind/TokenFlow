// The popup uses the canonical Dashboard nodes, chart renderers and API broker.
// Keep the other nodes in an inert archive because those renderers also update
// their auxiliary labels; no separate usage calculations live in the tray.
import {operationProgress} from './progress.js';
document.body.classList.add('mini-dashboard');
document.body.dataset.miniLoaded='false';
const $=id=>document.getElementById(id);
const main=document.querySelector('main');
const widgets={overview:document.querySelector('.summary-board'),trend:$('dailyTrend').closest('.panel'),models:$('modelShare').closest('.panel'),activity:$('usageHeatmap').closest('.panel'),composition:$('tokenMix').closest('.panel'),devices:$('deviceShare').closest('.panel'),cache:$('cacheHitRate').closest('.metric'),output:$('outputTokens').closest('.metric')};
const archive=document.createElement('div');archive.hidden=true;archive.inert=true;archive.id='miniArchive';
while(main.firstChild)archive.append(main.firstChild);
main.append(archive);
const content=document.createElement('div');content.id='miniWidgets';
for(const [name,node] of Object.entries(widgets)){node.dataset.miniWidget=name;content.append(node);}
const modelLimit=document.createElement('span');modelLimit.className='mini-model-limit';modelLimit.textContent='Top 4';widgets.models.querySelector('.section-head').append(modelLimit);
main.append(content);
const loading=document.createElement('p');loading.id='miniLoading';loading.setAttribute('role','status');main.insertBefore(loading,content);
document.querySelector('.desktop-toolbar').outerHTML=`<header class="mini-header">
  <div class="mini-title"><img class="mini-mark" src="/brand/tokenflow.svg" alt="" width="24" height="24"><strong>TokenFlow</strong>
    <nav class="mini-actions" aria-label="Dashboard actions">
      <button id="miniRefresh" class="mini-icon" type="button" aria-label="Refresh" title="Refresh"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10a8 8 0 0 0-14-4L3 9m0-5v5h5M4 14a8 8 0 0 0 14 4l3-3m0 5v-5h-5"/></svg><span id="miniRefreshProgress" class="mini-icon-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" hidden><svg viewBox="0 0 32 32" aria-hidden="true"><circle class="mini-progress-track" cx="16" cy="16" r="14"/><circle class="mini-progress-fill" cx="16" cy="16" r="14"/></svg></span></button>
      <button id="trayDashboard" class="mini-icon" type="button" aria-label="Open Dashboard" title="Open Dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6m0-6L11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg></button>
      <button id="miniSettings" class="mini-icon" type="button" aria-label="Settings" title="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m9 3-.6 2.4-2 .9-2.2-.7-2 3.4 1.6 1.7v2.6L2.2 15l2 3.4 2.2-.7 2 .9L9 21h4l.6-2.4 2-.9 2.2.7 2-3.4-1.6-1.7v-2.6L19.8 9l-2-3.4-2.2.7-2-.9L13 3Z" transform="translate(1 0)"/><circle cx="12" cy="12" r="3"/></svg></button>
    </nav>
  </div>
  <div class="mini-context"><span id="miniSource"></span><div class="mini-ranges" role="group" aria-label="Time range"><button data-mini-range="1">Today</button><button data-mini-range="7">7D</button><button data-mini-range="30">30D</button></div></div>
</header>`;
let latest,revision='',running=false,pending=false,started=false,lastHeight=0,lastError='';
const media=matchMedia('(prefers-color-scheme: dark)');
const words={en:{local:'This device',cloud:'Synced data',today:'Today',week:'7D',month:'30D',models:'Top 4',actions:'Dashboard actions',range:'Time range',settings:'Customize popup',refresh:'Refresh',open:'Open Dashboard',loading:'Loading Dashboard…'},zh:{local:'本机数据',cloud:'同步数据',today:'今日',week:'7天',month:'30天',models:'前4个模型',actions:'Dashboard 操作',range:'时间范围',settings:'设置小窗',refresh:'刷新',open:'打开 Dashboard',loading:'正在读取 Dashboard…'}};
function resize(){
  const height=Math.ceil(document.querySelector('.mini-header').getBoundingClientRect().height+main.getBoundingClientRect().height);
  if(Math.abs(height-lastHeight)>1){lastHeight=height;void window.tokenflow.resizeTray(height);}
}
function actions(){
  if(!latest)return;
  const t=words[latest.settings.language]||words.en;
  for(const [id,label] of [['miniSettings',t.settings],['trayDashboard',t.open]]){$(id).title=label;$(id).setAttribute('aria-label',label);}
  const operation=operationProgress(latest),button=$('miniRefresh'),progress=$('miniRefreshProgress');
  const busy=running||!!latest.busy||!!latest.pendingRequests||!!latest.fetchProgress?.activeRequests;
  const percent=operation?.percent;
  const error=lastError||latest.error;
  const detail=error||operation?.label||(running?t.loading:'');
  loading.textContent=error||t.loading;
  button.title=[t.refresh,detail,percent!=null?Math.floor(percent)+'%':''].filter(Boolean).join(' · ');
  button.setAttribute('aria-label',button.title);button.setAttribute('aria-busy',String(busy));
  button.classList.toggle('has-error',!!error);
  button.disabled=busy||!latest.cli.compatible;
  progress.hidden=!busy;progress.setAttribute('aria-label',detail||t.refresh);
  if(percent==null)progress.removeAttribute('aria-valuenow');else progress.setAttribute('aria-valuenow',String(percent));
  progress.querySelector('.mini-progress-fill').style.strokeDashoffset=String(88*(1-(percent??0)/100));
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
  const firstPaint=document.body.dataset.miniLoaded!=='true';
  if(!document.body.dataset.miniLoaded)document.body.dataset.miniLoaded='false';actions();
  try{window.tokenflowDashboard.miniRange(latest.settings.trayRange);
    if(!started){started=true;await window.tokenflowDashboard.boot();}else await window.tokenflowDashboard.refresh();
    document.body.dataset.miniLoaded='true';
    // Chart containers have no dimensions while the initial loading state hides
    // the widgets. Repaint the cached data once those containers are visible.
    if(firstPaint)window.tokenflowDashboard.repaint();
    lastError='';
  }catch(error){lastError=error.message;}
  finally{running=false;actions();resize();if(pending){pending=false;void refresh();}}
}
function update(state){
  latest=state;const t=words[state.settings.language]||words.en;
  window.tokenflowMini={range:state.settings.trayRange,widgets:state.settings.trayWidgets,needsHeatmap:state.settings.trayWidgets.some(name=>name!=='models')};
  for(const [name,node] of Object.entries(widgets)){
    node.hidden=!state.settings.trayWidgets.includes(name);
    if(node.hidden)archive.append(node);
  }
  // App preferences define both visibility and order, including layouts saved
  // by the visual editor. Move the canonical nodes rather than cloning charts.
  const order=Array.from(content.children,node=>node.dataset.miniWidget);
  if(JSON.stringify(order)!==JSON.stringify(state.settings.trayWidgets))for(const name of state.settings.trayWidgets)if(widgets[name])content.append(widgets[name]);
  $('miniSource').textContent=t[state.dashboardSource];
  document.querySelector('[data-mini-range="1"]').textContent=t.today;
  document.querySelector('[data-mini-range="7"]').textContent=t.week;
  document.querySelector('[data-mini-range="30"]').textContent=t.month;
  document.querySelector('.mini-actions').setAttribute('aria-label',t.actions);
  document.querySelector('.mini-ranges').setAttribute('aria-label',t.range);
  modelLimit.textContent=t.models;
  for(const button of document.querySelectorAll('[data-mini-range]'))button.setAttribute('aria-pressed',String(Number(button.dataset.miniRange)===state.settings.trayRange));
  actions();
  const key=JSON.stringify([window.tokenflowDashboard.currentDate(),state.dashboardSource,state.dashboardRevision,state.summary?.scannedAt,state.settings.serverUrl,state.account?.id,state.lastSyncAt,state.settings.trayRange,state.settings.trayWidgets,state.settings.language]);
  if(key!==revision){revision=key;window.tokenflowDashboard.language(state.settings.language);window.tokenflowDashboard.miniRange(state.settings.trayRange);theme();void refresh();}
  else theme();
  resize();
}
$('miniSettings').onclick=()=>window.tokenflow.openSettings('tray');
$('trayDashboard').onclick=()=>window.tokenflow.dashboard();
$('miniRefresh').onclick=async()=>{try{lastError='';if(latest.dashboardSource==='local')await window.tokenflow.scan();await refresh();}catch(error){lastError=error.message;actions();}};
for(const button of document.querySelectorAll('[data-mini-range]'))button.onclick=()=>window.tokenflow.saveSettings({trayRange:Number(button.dataset.miniRange)});
media.addEventListener('change',theme);
// A popup can stay alive for days without new usage. Check the date when it
// reopens or resumes, and while it remains visible across midnight.
function refreshDate(){if(latest && document.visibilityState==='visible')update(latest);}
window.addEventListener('focus',refreshDate);
document.addEventListener('visibilitychange',refreshDate);
setInterval(refreshDate,60_000);
new ResizeObserver(resize).observe(main);
window.tokenflow.onState(update);window.tokenflow.getState().then(update);
