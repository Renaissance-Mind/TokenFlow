// Data changes redraw the existing Dashboard; authentication never navigates it.
import {renderProgress} from './progress.js';
import {renderWindowChrome} from './window-chrome.js';
import {createLoginDialog} from './login-dialog.js';
if (new URLSearchParams(location.search).get('mode') === 'tray') {
  if (new URLSearchParams(location.search).get('editor') === '1') await import('./editor-preview.js');
  await import('./tray.js');
} else {
let latest, started=false, revision='', refreshing=false, pending=false, dataReady=false, loadError='';
const loginDialog=createLoginDialog();
const $=id=>document.getElementById(id);
const dataContext=state=>[state.dashboardSource,state.settings.serverUrl,state.account?.id].join('|');
const words={en:{prepare:'Preparing statistics…',local:'This device’s data',cloud:'Synced data',scan:'Reading usage…',pricing:'Fetching pricing…',upload:'Syncing…',refresh:'Refresh',sync:'Sync',settings:'Settings',signIn:'Sign in',hint:'Your statistics will appear as soon as reading finishes.',retry:'Retry',failed:'Unable to load statistics',required:'Update the CLI in Settings to enable local statistics.'},zh:{prepare:'正在准备统计…',local:'本机数据',cloud:'同步数据',scan:'正在读取用量…',pricing:'正在获取价格…',upload:'正在同步…',refresh:'刷新',sync:'同步',settings:'设置',signIn:'登录',hint:'读取完成后，即可查看统计。',retry:'重试',failed:'无法加载统计',required:'请在设置中更新 CLI，以启用本地统计。'}};
function activity(){
  if(!latest)return;
  renderWindowChrome(latest);renderProgress(latest);
  const t=words[latest.settings.language]||words.en;
  const signedOut=latest.dashboardSource==='local'&&!latest.hasDashboard&&!latest.account;
  $('desktopDataSource').hidden=signedOut;
  $('desktopSignIn').hidden=!signedOut;
  $('desktopDataSource').textContent=t[latest.dashboardSource];
  $('desktopLoading').hidden=dataReady;
  document.querySelector('main').inert=!dataReady;
  document.querySelector('main').setAttribute('aria-busy',String(!dataReady));
  const failure=loadError||(!latest.cli.compatible?t.required:(!latest.busy&&!refreshing?latest.error:''));
  $('desktopLoadingSpinner').hidden=!!failure;
  $('desktopLoadingTitle').textContent=failure?t.failed:t.prepare;
  $('desktopLoadingHint').textContent=failure||t.hint;
  $('desktopRetry').hidden=!failure;
  $('desktopRetry').disabled=!!latest.busy||refreshing||!latest.cli.compatible;
  $('desktopRetry').textContent=t.retry;
  $('desktopActivity').textContent=loadError||latest.notice||latest.error||(!latest.summary&&latest.cli.compatible?t.prepare:'');
  $('desktopActivity').hidden=!$('operationProgress').hidden||!$('desktopActivity').textContent;
  document.querySelector('.desktop-toolbar').classList.toggle('is-reading',!!latest.busy);
  for(const [id,key] of [['desktopRefresh','refresh'],['desktopSync','sync'],['desktopSettings','settings'],['desktopSignIn','signIn']]){ $(id).title=t[key]; $(id).setAttribute('aria-label',t[key]); }
  $('desktopRefresh').disabled=!!latest.busy||latest.loginBusy||!latest.cli.compatible;
  $('desktopSync').disabled=!!latest.busy||latest.loginBusy||!latest.hasCollector||!latest.cli.compatible;
}
async function refresh(){
  if(refreshing){pending=true;return;}
  if(!latest || (latest.dashboardSource==='local'&&!latest.summary))return;
  refreshing=true;loadError='';const context=dataContext(latest);activity();
  try {
    if(!started){await window.tokenflowDashboard.boot();started=true;}else await window.tokenflowDashboard.refresh();
    if(context===dataContext(latest))dataReady=true;
  }
  catch(error){loadError=error.message;$('desktopActivity').textContent=error.message;}
  finally{refreshing=false;activity();if(pending){pending=false;void refresh();}}
}
function update(state){
  document.body.inert=state.settingsOpen;
  document.body.style.visibility=state.settingsOpen?'hidden':'visible';
  document.body.setAttribute('aria-hidden',String(state.settingsOpen));
  const previous=latest;latest=state;
  if(previous && dataContext(previous)!==dataContext(state))dataReady=false;
  loginDialog.update(state);activity();
  if(!previous||previous.settings.language!==state.settings.language)window.tokenflowDashboard.language(state.settings.language);
  const key=[state.dashboardSource,state.summary?.scannedAt,state.settings.serverUrl,state.account?.id,state.lastSyncAt].join('|');
  if(key!==revision){revision=key;void refresh();}
}
async function runAction(action){
  try {loadError='';await action();await refresh();}
  catch(error){loadError=error.message;activity();}
}
$('desktopSignIn').onclick=()=>loginDialog.open();
$('desktopRetry').onclick=()=>void runAction(()=>window.tokenflow.scan());
$('desktopSettings').onclick=()=>window.tokenflow.openSettings();
$('desktopRefresh').onclick=()=>void runAction(async()=>{await window.tokenflow.dashboard();await window.tokenflow.scan();});
$('desktopSync').onclick=()=>void runAction(()=>window.tokenflow.sync());
// The embedded web picker must use the same saved language as Settings/tray.
// Only offer languages supported by the surrounding App interface.
for(const option of document.querySelectorAll('[data-language-option]')){
  const language=option.dataset.languageOption;
  if(!words[language]){option.remove();continue;}
  option.onclick=async()=>{
    try{
      await window.tokenflow.saveSettings({language});
      $('languageMenuPanel').hidden=true;$('languageToggle').setAttribute('aria-expanded','false');$('languageToggle').focus();
    }catch(error){$('desktopActivity').textContent=error.message;$('desktopActivity').hidden=false;}
  };
}
// Keep the web sidebar and filters aligned to the single native toolbar.
new ResizeObserver(([entry])=>document.documentElement.style.setProperty('--desktop-toolbar-height',entry.target.getBoundingClientRect().height+'px')).observe(document.querySelector('.desktop-toolbar'));
window.tokenflow.onState(update);window.tokenflow.getState().then(update);

}
