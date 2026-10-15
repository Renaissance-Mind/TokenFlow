import {renderProgress} from './progress.js';
import {renderWindowChrome} from './window-chrome.js';
const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get('mode') === 'tray' ? 'tray' : 'settings';
const trayMode = mode === 'tray';
document.body.classList.add(mode === 'settings' ? 'settings-page' : mode);
if (!trayMode) {
  const header=document.querySelector('header');header.classList.add('window-toolbar');
  const progress=$('operationProgress');progress.classList.add('compact-progress');
  header.insertBefore(progress,header.querySelector('.header-actions'));
}
const texts = {
  en: { today:'TODAY',tokens:'tokens',estimate:'Estimated from recorded usage',week:'LAST SEVEN DAYS',todayShort:'Today',refresh:'Refresh',sync:'Sync now →',accountTitle:'Account & sync',connectDescription:'Account and sync settings are shared with the terminal.',github:'Sign in with GitHub',google:'Sign in with Google',waiting:'Finish signing in in your browser.',cancel:'Cancel login',dashboard:'Dashboard →',logout:'Sign out App & CLI',switchAccount:'Switch account',cancelSwitch:'Cancel account switch',settings:'Settings',preferences:'Preferences',device:'Device name',server:'Server',menuMetric:'Menu bar display',costMetric:'Today’s cost',tokenMetric:'Today’s tokens',iconMetric:'Icon only',language:'Language',launch:'Start at login',pause:'Pause automatic sync',save:'Save preferences',sources:'Local sources',metadata:'Only usage counts are uploaded.',update:'Check App updates',download:'Download update',install:'Install and restart',offline:'Local usage',paused:'Automatic sync paused',scan:'Reading local usage…',syncing:'Syncing usage…',login:'Waiting for browser authorization…',ready:'Automatic sync every 10 minutes',empty:'No recorded usage today.',unpriced:'tokens have no price; the cost estimate is incomplete',scanned:'Read',lastSync:'Last sync',missing:'Not found',current:'You’re up to date',checking:'Checking for updates…',available:'Update available',downloading:'Downloading',downloaded:'Ready to install',collector:'CLI',error:'Connection unavailable.',pricing:'Fetching pricing…',upload:'Uploading usage statistics…',loginStarting:'Starting browser sign-in…',dashboardTitle:'Dashboard',loadingHint:'Your statistics will appear as soon as reading finishes.',apiToken:'Read-write API token',saveToken:'Connect token',cliTitle:'CLI',checkCliUpdate:'Check CLI updates',upgradeCli:'Upgrade CLI →',installed:'Using your installed CLI. Its connection and data are shared with the terminal.',managed:'App and terminal use the same installation.',required:'Upgrade the installed CLI to enable local statistics.',installing:'Installing CLI…',backDashboard:'Back to Dashboard',accountNav:'Account',cliUpdates:'CLI & updates',settingsSubtitle:'Your App and CLI, connected.',yourAccount:'Your account',launchHint:'Open TokenFlow when you sign in to your computer',pauseHint:'Manual sync is always available',appTitle:'TokenFlow App',connectedCLI:'Connected to CLI',connected:'Connected',local:'Local statistics',cliLogin:'CLI sign-in reused',cloudLogin:'Sign in in Settings to view all devices.',tokenSaved:'API token connected.',saved:'Preferences saved.' },
  zh: { today:'今日用量',tokens:'tokens',estimate:'根据已记录用量估算费用',week:'最近七天',todayShort:'今天',refresh:'刷新',sync:'立即同步 →',accountTitle:'账号与同步',connectDescription:'账号与同步设置和 CLI 共用，这里的修改也会用于终端。',github:'通过 GitHub 登录',google:'通过 Google 登录',waiting:'请在浏览器中完成登录与授权。',cancel:'取消登录',dashboard:'打开看板 →',logout:'退出 App 与 CLI',switchAccount:'切换账号',cancelSwitch:'取消切换',settings:'设置',preferences:'偏好设置',device:'设备名称',server:'服务器',menuMetric:'菜单栏显示',costMetric:'今日费用',tokenMetric:'今日 tokens',iconMetric:'仅图标',language:'语言',launch:'登录系统时启动',pause:'暂停自动同步',save:'保存设置',sources:'本地数据来源',metadata:'仅上传用量统计。',update:'检查 App 更新',download:'下载更新',install:'安装并重启',offline:'本地统计',paused:'已暂停自动同步',scan:'正在读取本地用量…',syncing:'正在同步用量…',login:'等待浏览器授权…',ready:'每 10 分钟自动同步',empty:'今天尚无用量记录。',unpriced:'tokens 暂无价格，费用估算尚不完整',scanned:'读取时间',lastSync:'上次同步',missing:'未找到',current:'已是最新版本',checking:'正在检查更新…',available:'有可用更新',downloading:'正在下载',downloaded:'已下载，可安装',collector:'CLI',error:'连接不可用。',pricing:'正在获取计费信息…',upload:'正在上传用量统计…',loginStarting:'正在发起浏览器登录…',dashboardTitle:'Dashboard',loadingHint:'读取完成后，即可查看统计。',apiToken:'可读写 API token',saveToken:'连接 token',cliTitle:'CLI',checkCliUpdate:'检查 CLI 更新',upgradeCli:'升级 CLI →',installed:'正在使用已有 CLI；登录与数据和终端共用。',managed:'已为本机安装 CLI；App 与终端使用同一份安装。',required:'请升级已有 CLI，以启用本地统计。',installing:'正在安装 CLI…',backDashboard:'返回 Dashboard',accountNav:'账号',cliUpdates:'CLI 与更新',settingsSubtitle:'App 与 CLI，使用同一份配置。',yourAccount:'当前账号',launchHint:'登录电脑时自动打开 TokenFlow',pauseHint:'仍可随时手动同步',appTitle:'TokenFlow App',connectedCLI:'已连接 CLI',connected:'已连接',local:'本地统计',cliLogin:'已沿用 CLI 登录',cloudLogin:'在设置中登录，即可查看全部设备。',tokenSaved:'API token 已连接。',saved:'设置已保存。' },
};
Object.assign(texts.en,{popupTitle:'Menu bar popup',popupDescription:'Choose the Dashboard sections shown when you click the menu bar icon.',popupRange:'Default time range',popup7:'Last 7 days',popup30:'Last 30 days',popupTheme:'Appearance',popupSystem:'Follow system',popupLight:'Light',popupDark:'Dark',popupSections:'Dashboard sections',popupOverview:'Usage overview',popupOverviewHint:'Tokens, cost, and mini trends',popupTrend:'Daily trend',popupTrendHint:'The same usage chart as Dashboard',popupModels:'Model distribution',popupModelsHint:'See your largest cost drivers',popupActivity:'Token activity',popupActivityHint:'Your activity across the year',savePopup:'Save popup',popupSaved:'Popup saved.',popupRequired:'Choose at least one Dashboard section.'});
Object.assign(texts.zh,{popupTitle:'菜单栏小窗',popupDescription:'点击菜单栏图标时，展示你选择的 Dashboard 模块。',popupRange:'默认时间范围',popup7:'最近 7 天',popup30:'最近 30 天',popupTheme:'外观',popupSystem:'跟随系统',popupLight:'浅色',popupDark:'深色',popupSections:'显示模块',popupOverview:'用量总览',popupOverviewHint:'Token、费用与迷你走势',popupTrend:'每日趋势',popupTrendHint:'与 Dashboard 相同的用量曲线',popupModels:'模型分布',popupModelsHint:'查看主要模型的费用占比',popupActivity:'Token 活跃度',popupActivityHint:'查看一整年的使用节奏',savePopup:'保存小窗设置',popupSaved:'小窗设置已保存。',popupRequired:'请至少选择一个 Dashboard 模块。'});
let current, dirty = false, trayDirty=false, switchingAccount = false;
const number = (n) => Number(n || 0).toLocaleString();
const time = (value) => value ? new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
const localDate = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
function renderActivity(state) {
  const t = texts[state.settings.language === 'zh' ? 'zh' : 'en'];
  const elapsed = state.collectionStartedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(state.collectionStartedAt)) / 1000)) : 0;
  const duration = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2,'0')}`;
  const activity = state.busy ? ({scan:t.scan,pricing:t.pricing,upload:t.upload,sync:t.syncing})[state.collectionPhase || state.busy] + ` (${duration})` : '';
  $('status').textContent = !state.cli.compatible ? t.required : activity || (state.settings.paused ? t.paused : state.hasCollector ? t.ready + (state.lastSyncAt ? ' · ' + time(state.lastSyncAt) : '') : t.offline);
  $('loadingTitle').textContent = activity;
  $('loading').hidden = !state.busy;
  document.body.classList.toggle('reading', !!state.busy && !state.summary);
}
function render(state) {
  if (state.hasDashboard && (current?.account?.id !== state.account?.id || (current?.loginBusy && !state.loginBusy))) switchingAccount = false;
  current = state; renderWindowChrome(state);renderProgress(state);
  const lang = state.settings.language === 'zh' ? 'zh' : 'en';
  const t = texts[lang]; document.documentElement.lang = lang;
  document.querySelectorAll('[data-text]').forEach((node) => { node.textContent = t[node.dataset.text]; });
  $('version').textContent = 'v' + state.version;
  $('collectorVersion').textContent = 'v' + state.collectorVersion;
  $('account').textContent = state.account?.name || state.account?.email || '';
  $('connection').textContent = state.hasCollector ? t.connected : t.local;
  $('authStatus').classList.toggle('connected',state.hasDashboard);
  $('authStatus').textContent = state.hasDashboard ? t.connectedCLI : state.hasCollector ? t.cliLogin : t.local;
  $('accountDetails').textContent = state.account?.email || state.account?.name || t.connected;
  $('connectedSection').hidden = !state.hasCollector && !state.hasDashboard;
  $('loginSection').hidden = state.hasDashboard && !switchingAccount;
  $('tokenForm').hidden = state.hasDashboard && !switchingAccount;
  $('switchAccount').textContent = switchingAccount ? t.cancelSwitch : t.switchAccount;
  $('switchAccount').disabled = state.loginBusy;
  const candidate = state.summary?.today;
  const today = candidate?.date === localDate() ? candidate : null;
  $('cost').textContent = today ? '$' + Number(today.costUsd).toFixed(2) : '—';
  $('tokens').textContent = today ? number(today.tokens) : '—';
  $('priceNote').textContent = today?.unpricedTokens ? number(today.unpricedTokens) + ' ' + t.unpriced : t.estimate;
  $('empty').hidden = state.busy || !today || today.tokens > 0;
  $('agents').replaceChildren(...(state.summary?.agents || []).map((agent) => {
    const el = document.createElement('span'); el.className = 'agent';
    const dot = document.createElement('i'); const name = document.createElement('strong'); name.textContent = agent.agent;
    const count = document.createElement('span'); count.textContent = number(agent.tokens);
    el.append(dot,name,count); return el;
  }));
  const days = state.summary?.days || [];
  const max = Math.max(1, ...days.map((day) => day.tokens));
  $('sparkPath').setAttribute('d', days.map((day,i) => `${i ? 'L' : 'M'}${(i * 390 / 6 + 5).toFixed(2)},${(110 - day.tokens / max * 95).toFixed(2)}`).join(' '));
  $('spark').setAttribute('aria-label', days.map((day) => `${day.date}: ${number(day.tokens)} tokens`).join('; '));
  $('weekStart').textContent = days[0]?.date.slice(5) || '—';
  $('weekTotal').textContent = number(days.reduce((sum,day) => sum + day.tokens,0)) + ' tokens';
  renderActivity(state);
  $('statusDot').className = 'status-dot' + (state.busy ? ' busy' : state.error ? ' error' : state.hasCollector && !state.settings.paused ? ' ready' : '');
  $('error').hidden = !state.error; $('error').textContent = state.error || '';
  $('notice').hidden = !state.notice; $('notice').textContent = state.notice || '';
  $('sync').disabled = !!state.busy || state.loginBusy || !state.hasCollector || !state.cli.compatible;
  $('refresh').disabled = !!state.busy || !state.cli.compatible;
  $('github').disabled = state.loginBusy || !state.cli.compatible; $('google').disabled = state.loginBusy || !state.cli.compatible;
  $('loginPending').hidden = !state.loginBusy;
  $('loginStatus').hidden = !!state.login;
  $('loginInstructions').hidden = !state.login;
  $('loginCode').textContent = state.login?.code || '';
  $('save').disabled = !!state.busy || state.loginBusy || !state.cli.compatible;
  $('saveToken').disabled = state.loginBusy || !state.cli.compatible;
  $('logout').disabled = state.loginBusy;
  if (!dirty) {
    for (const key of ['deviceName','serverUrl','trayMetric','language']) $(key).value = state.settings[key];
    for (const key of ['launchAtLogin','paused']) $(key).checked = state.settings[key];
  }
  if(!trayDirty){
    $('trayRange').value=String(state.settings.trayRange);$('trayTheme').value=state.settings.trayTheme;
    document.querySelectorAll('[name="trayWidgets"]').forEach(input=>{input.checked=state.settings.trayWidgets.includes(input.value);});
  }
  $('saveTray').disabled=false;
  $('serverUrl').disabled = state.hasCollector || state.hasDashboard || !!state.busy || state.loginBusy;
  $('cliSource').textContent = t[state.cli.source]; $('cliPath').textContent = state.cli.path.replace(/^(\/Users\/[^/]+|\/home\/[^/]+)\//,'~/'); $('cliPath').title = state.cli.path;
  const updating = ['checking','installing'].includes(state.cli.updateStatus);
  $('checkCliUpdate').disabled = updating;
  $('upgradeCli').hidden = !['required','available','error'].includes(state.cli.updateStatus);
  $('upgradeCli').disabled = updating || state.loginBusy;
  $('cliUpdateStatus').textContent = t[state.cli.updateStatus] || '';
  if (state.cli.availableVersion && state.cli.updateStatus === 'available') $('cliUpdateStatus').textContent += ' · v' + state.cli.availableVersion;
  const sources = state.summary?.sources || [];
  $('sourceCount').textContent = `${sources.filter((source) => source.exists).length} / ${sources.length}`;
  $('sourceList').replaceChildren(...sources.map((source) => {
    const el = document.createElement('li'); const name = document.createElement('strong'); name.textContent = source.agent;
    const status = document.createElement('span'); status.textContent = source.exists ? `${source.files} files` : t.missing;
    const location = document.createElement('span'); location.textContent = source.path;
    el.append(name,status,location); return el;
  }));
  $('scanned').textContent = t.scanned + ' ' + time(state.summary?.scannedAt);
  $('downloadUpdate').hidden = state.update.status !== 'available';
  $('installUpdate').hidden = state.update.status !== 'downloaded';
  $('update').disabled = ['checking','downloading'].includes(state.update.status);
  $('updateStatus').textContent = state.update.message || ({current:t.current,checking:t.checking,available:t.available,downloading:t.downloading + ' ' + Math.round(state.update.percent || 0) + '%',downloaded:t.downloaded,error:t.error})[state.update.status] || '';
}
async function run(action) {
  try { await action(); } catch (error) { $('error').textContent = String(error.message); $('error').hidden = false; }
}
if (!window.tokenflow) {
  $('error').hidden = false; $('error').textContent = 'Open this screen in TokenFlow Desktop.';
} else {
  window.tokenflow.onState(render);
  run(async () => render(await window.tokenflow.getState()));
  $('preferences').addEventListener('input', () => { dirty = true; $('savedStatus').textContent=''; });
  $('preferences').addEventListener('submit', (event) => {
    event.preventDefault(); run(async () => {
      await window.tokenflow.saveSettings({deviceName:$('deviceName').value,serverUrl:$('serverUrl').value,trayMetric:$('trayMetric').value,language:$('language').value,launchAtLogin:$('launchAtLogin').checked,paused:$('paused').checked});
      dirty = false; render(await window.tokenflow.getState()); $('savedStatus').textContent = texts[current.settings.language].saved;
    });
  });
  $('trayPreferences').addEventListener('input',()=>{trayDirty=true;$('traySavedStatus').textContent='';});
  $('trayPreferences').addEventListener('submit',event=>{
    event.preventDefault();const widgets=Array.from(document.querySelectorAll('[name="trayWidgets"]:checked'),input=>input.value);
    if(!widgets.length){$('traySavedStatus').textContent=texts[current.settings.language].popupRequired;return;}
    run(async()=>{await window.tokenflow.saveSettings({trayRange:Number($('trayRange').value),trayTheme:$('trayTheme').value,trayWidgets:widgets});trayDirty=false;render(await window.tokenflow.getState());$('traySavedStatus').textContent=texts[current.settings.language].popupSaved;});
  });
  $('tokenForm').addEventListener('submit', (event) => {
    event.preventDefault(); run(async () => { await window.tokenflow.setApiToken($('apiToken').value); $('apiToken').value = ''; switchingAccount = false; render(await window.tokenflow.getState()); });
  });
  $('github').onclick = () => run(() => window.tokenflow.login('github'));
  $('google').onclick = () => run(() => window.tokenflow.login('google'));
  $('cancel').onclick = () => run(() => window.tokenflow.cancelLogin());
  $('refresh').onclick = () => run(() => window.tokenflow.scan());
  $('sync').onclick = () => run(() => window.tokenflow.sync());
  const dashboard = () => run(() => window.tokenflow.dashboard());
  $('breadcrumbDashboard').onclick = dashboard;
  const selectSection=section=>{const button=document.querySelector('[data-section="'+section+'"]');if(!button)return;document.getElementById(section).scrollIntoView({behavior:'smooth',block:'start'});document.querySelectorAll('[data-section]').forEach(item=>{item.classList.toggle('active',item===button);if(item===button)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');});};
  document.querySelectorAll('[data-section]').forEach(button=>button.onclick=()=>selectSection(button.dataset.section));
  window.tokenflow.onSettingsSection(selectSection);
  $('dashboardShortcut').onclick = dashboard; $('trayDashboard').onclick = dashboard;
  $('switchAccount').onclick = () => { switchingAccount = !switchingAccount; render(current); };
  $('logout').onclick = () => run(() => window.tokenflow.logout());
  $('settingsShortcut').onclick = () => run(() => window.tokenflow.openSettings());
  $('update').onclick = () => run(() => window.tokenflow.checkUpdate());
  $('downloadUpdate').onclick = () => run(() => window.tokenflow.downloadUpdate());
  $('installUpdate').onclick = () => run(() => window.tokenflow.installUpdate());
  $('checkCliUpdate').onclick = () => run(() => window.tokenflow.checkCliUpdate());
  $('upgradeCli').onclick = () => run(() => window.tokenflow.upgradeCli());
  setInterval(() => { if (current?.busy) renderActivity(current); }, 1000);
}
