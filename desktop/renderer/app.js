const $ = (id) => document.getElementById(id);
const trayMode = new URLSearchParams(location.search).get('mode') === 'tray';
if (trayMode) document.body.classList.add('tray');
const texts = {
  en: { today:'THIS COMPUTER / TODAY',tokens:'tokens',estimate:'Estimated from recorded usage',week:'LAST SEVEN DAYS',todayShort:'Today',refresh:'Refresh',sync:'Sync now →',connect:'One account. Every device.',connectDescription:'Connect this computer and see your full dashboard. Your prompts and responses stay here.',github:'Continue with GitHub',google:'Continue with Google',waiting:'Finish signing in in your browser.',cancel:'Cancel login',dashboard:'Open full dashboard ↗',logout:'Sign out',settings:'PREFERENCES',device:'Device name',server:'Server',menuMetric:'Menu bar display',costMetric:'Today’s cost',tokenMetric:'Today’s tokens',iconMetric:'Icon only',language:'Language',launch:'Start at login',pause:'Pause automatic sync',save:'Save preferences →',sources:'Local sources',metadata:'Only usage counts are uploaded.',update:'Check for updates',download:'Download update',install:'Install and restart',offline:'Local usage · sign in to sync',paused:'Automatic sync paused',scan:'Reading local usage…',syncing:'Syncing usage…',login:'Waiting for browser authorization…',ready:'Automatic sync every 10 minutes',empty:'No recorded usage today',unpriced:'tokens have no price; the cost estimate is incomplete',scanned:'Read',lastSync:'Last sync',found:'available',missing:'Not found',current:'You’re up to date',checking:'Checking for updates…',available:'Update available',downloading:'Downloading',downloaded:'Ready to install',collector:'Collector',error:'Desktop connection unavailable.' },
  zh: { today:'本机 / 今日用量',tokens:'tokens',estimate:'根据已记录用量估算费用',week:'最近七天',todayShort:'今天',refresh:'刷新',sync:'立即同步 →',connect:'一个账号，连接所有设备。',connectDescription:'连接本机，查看完整看板。你的提示词和回答始终留在本机。',github:'通过 GitHub 登录',google:'通过 Google 登录',waiting:'请在浏览器中完成登录与授权。',cancel:'取消登录',dashboard:'打开完整看板 ↗',logout:'退出登录',settings:'偏好设置',device:'设备名称',server:'服务器',menuMetric:'菜单栏显示',costMetric:'今日费用',tokenMetric:'今日 tokens',iconMetric:'仅图标',language:'语言',launch:'登录系统时启动',pause:'暂停自动同步',save:'保存设置 →',sources:'本地数据来源',metadata:'仅上传用量统计。',update:'检查更新',download:'下载更新',install:'安装并重启',offline:'本地统计 · 登录后自动同步',paused:'已暂停自动同步',scan:'正在读取本地用量…',syncing:'正在同步用量…',login:'等待浏览器授权…',ready:'每 10 分钟自动同步',empty:'今天尚无用量记录',unpriced:'tokens 暂无价格，费用估算尚不完整',scanned:'读取时间',lastSync:'上次同步',found:'已找到',missing:'未找到',current:'已是最新版本',checking:'正在检查更新…',available:'有可用更新',downloading:'正在下载',downloaded:'已下载，可安装',collector:'采集器',error:'桌面连接不可用。' },
};
let current;
let dirty = false;
const number = (n) => Number(n || 0).toLocaleString();
const time = (value) => value ? new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '—';
function render(state) {
  if (!state?.settings) return;
  current = state;
  const lang = state.settings.language === 'zh' ? 'zh' : 'en';
  const t = texts[lang]; document.documentElement.lang = lang;
  document.querySelectorAll('[data-text]').forEach((node) => { node.textContent = t[node.dataset.text]; });
  $('version').textContent = 'v' + state.version;
  $('collectorVersion').textContent = t.collector + ' v' + state.collectorVersion;
  $('account').textContent = state.account?.name || state.account?.email || '';
  const candidate = state.summary?.today;
  const today = candidate?.date === new Date().toLocaleDateString('en-CA') ? candidate : null;
  $('cost').textContent = today ? '$' + Number(today.costUsd).toFixed(2) : '—';
  $('tokens').textContent = today ? number(today.tokens) : '—';
  $('priceNote').textContent = today?.unpricedTokens ? number(today.unpricedTokens) + ' ' + t.unpriced : t.estimate;
  $('agents').replaceChildren(...(state.summary?.agents || []).slice(0, 5).map((agent) => {
    const el = document.createElement('span'); el.className = 'agent';
    const dot = document.createElement('i'); const name = document.createElement('strong'); name.textContent = agent.agent;
    const count = document.createElement('span'); count.textContent = number(agent.tokens);
    el.append(dot,name,count); return el;
  }));
  $('agents').hidden = trayMode && !state.summary?.agents?.length;
  const days = state.summary?.days || [];
  const max = Math.max(1, ...days.map((day) => day.tokens));
  $('sparkPath').setAttribute('d', days.map((day,i) => `${i ? 'L' : 'M'}${(i * 390 / 6 + 5).toFixed(2)},${(110 - day.tokens / max * 95).toFixed(2)}`).join(' '));
  $('spark').setAttribute('aria-label', days.map((day) => `${day.date}: ${number(day.tokens)} tokens`).join('; '));
  $('weekStart').textContent = days[0]?.date.slice(5) || '—';
  $('weekTotal').textContent = number(days.reduce((sum,day) => sum + day.tokens,0)) + ' tokens';
  $('status').textContent = state.busy ? ({scan:t.scan,sync:t.syncing,login:t.login})[state.busy]
    : state.settings.paused ? t.paused : state.hasCollector ? t.ready + (state.lastSyncAt ? ' · ' + time(state.lastSyncAt) : '') : t.offline;
  $('statusDot').className = 'status-dot' + (state.error ? ' error' : state.hasCollector && !state.settings.paused ? ' ready' : '');
  $('error').hidden = !state.error; $('error').textContent = state.error || '';
  $('notice').hidden = !state.notice; $('notice').textContent = state.notice || '';
  $('sync').disabled = !!state.busy || !state.hasCollector;
  $('refresh').disabled = !!state.busy;
  $('github').disabled = !!state.busy; $('google').disabled = !!state.busy;
  $('loginSection').hidden = state.hasDashboard;
  $('connectedSection').hidden = !state.hasDashboard;
  $('loginPending').hidden = !state.login;
  $('loginCode').textContent = state.login?.code || '';
  $('save').disabled = !!state.busy;
  $('logout').disabled = !!state.busy;
  if (!dirty) {
    for (const key of ['deviceName','serverUrl','trayMetric','language']) $(key).value = state.settings[key];
    for (const key of ['launchAtLogin','paused']) $(key).checked = state.settings[key];
  }
  $('serverUrl').disabled = state.hasCollector || state.hasDashboard || !!state.busy;
  const sources = state.summary?.sources || [];
  $('sourceCount').textContent = `${sources.filter((source) => source.exists).length} / ${sources.length}`;
  $('sourceList').replaceChildren(...sources.map((source) => {
    const el = document.createElement('li');
    const name = document.createElement('strong'); name.textContent = source.agent;
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
  try { await action(); }
  catch (error) { $('error').textContent = String(error.message); $('error').hidden = false; }
}
if (!window.tokenflow) {
  $('error').hidden = false; $('error').textContent = 'Open this screen in TokenFlow Desktop.';
} else {
  window.tokenflow.onState(render);
  run(async () => render(await window.tokenflow.getState()));
  $('preferences').addEventListener('input', () => { dirty = true; });
  $('preferences').addEventListener('submit', (event) => {
    event.preventDefault();
    run(async () => {
      await window.tokenflow.saveSettings({deviceName:$('deviceName').value,serverUrl:$('serverUrl').value,trayMetric:$('trayMetric').value,language:$('language').value,launchAtLogin:$('launchAtLogin').checked,paused:$('paused').checked});
      dirty = false; render(await window.tokenflow.getState());
    });
  });
  $('github').onclick = () => run(() => window.tokenflow.login('github'));
  $('google').onclick = () => run(() => window.tokenflow.login('google'));
  $('cancel').onclick = () => run(() => window.tokenflow.cancelLogin());
  $('refresh').onclick = () => run(() => window.tokenflow.scan());
  $('sync').onclick = () => run(() => window.tokenflow.sync());
  $('dashboard').onclick = () => run(() => window.tokenflow.dashboard());
  $('logout').onclick = () => run(() => window.tokenflow.logout());
  $('settingsShortcut').onclick = () => run(() => window.tokenflow.openSettings());
  $('update').onclick = () => run(() => window.tokenflow.checkUpdate());
  $('downloadUpdate').onclick = () => run(() => window.tokenflow.downloadUpdate());
  $('installUpdate').onclick = () => run(() => window.tokenflow.installUpdate());
}
