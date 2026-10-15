// Data changes redraw the existing Dashboard; authentication never navigates it.
import {renderProgress} from './progress.js';
let latest, started=false, revision='', refreshing=false, pending=false;
const $=id=>document.getElementById(id);
const words={en:{local:'This device’s data',cloud:'Synced data',scan:'Reading usage…',pricing:'Fetching pricing…',upload:'Syncing…',refresh:'Refresh',sync:'Sync',settings:'Settings'},zh:{local:'本机数据',cloud:'同步数据',scan:'正在读取用量…',pricing:'正在获取价格…',upload:'正在同步…',refresh:'刷新',sync:'同步',settings:'设置'}};
function activity(){
  if(!latest)return;
  renderProgress(latest);
  const t=words[latest.settings.language]||words.en;
  $('desktopDataSource').textContent=t[latest.dashboardSource];
  $('desktopActivity').textContent=latest.busy?(t[latest.collectionPhase||'scan']||t.scan):latest.notice||latest.error||'';
  document.querySelector('.desktop-toolbar').classList.toggle('is-reading',!!latest.busy);
  for(const [id,key] of [['desktopRefresh','refresh'],['desktopSync','sync'],['desktopSettings','settings']])$(id).textContent=t[key];
  $('desktopRefresh').disabled=!!latest.busy||!latest.cli.compatible;
  $('desktopSync').disabled=!!latest.busy||!latest.hasCollector||!latest.cli.compatible;
}
async function refresh(){
  if(refreshing){pending=true;return;}
  refreshing=true;
  try {if(!started){started=true;await window.tokenflowDashboard.boot();}else await window.tokenflowDashboard.refresh();}
  catch(error){$('desktopActivity').textContent=error.message;}
  finally{refreshing=false;if(pending){pending=false;void refresh();}}
}
function update(state){
  document.body.inert=state.settingsOpen;
  document.body.style.visibility=state.settingsOpen?'hidden':'visible';
  document.body.setAttribute('aria-hidden',String(state.settingsOpen));
  const previous=latest;latest=state;activity();
  if(!previous||previous.settings.language!==state.settings.language)window.tokenflowDashboard.language(state.settings.language);
  const key=[state.dashboardSource,state.summary?.scannedAt,state.settings.serverUrl,state.account?.id,state.lastSyncAt].join('|');
  if(key!==revision){revision=key;void refresh();}
}
$('desktopSettings').onclick=()=>window.tokenflow.openSettings();
$('desktopRefresh').onclick=async()=>{await window.tokenflow.dashboard();await window.tokenflow.scan();await refresh();};
$('desktopSync').onclick=async()=>{await window.tokenflow.sync();await refresh();};
// The web sidebar and sticky filters must clear both native activity bars,
// including when the toolbar wraps in a smaller App window.
new ResizeObserver(([entry])=>document.documentElement.style.setProperty('--desktop-toolbar-height',entry.target.getBoundingClientRect().height+'px')).observe(document.querySelector('.desktop-toolbar'));
window.tokenflow.onState(update);window.tokenflow.getState().then(update);
