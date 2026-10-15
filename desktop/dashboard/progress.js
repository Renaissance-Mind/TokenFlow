const labels = {
  en: { scan:'Reading usage…',pricing:'Fetching pricing…',upload:'Syncing usage…',fetch:'Fetching data…',login:'Waiting for authorization…',appCheck:'Checking App updates…',cliCheck:'Checking CLI updates…',cliInstall:'Updating CLI…',download:'Downloading update…',available:'App update available',downloaded:'Update downloaded · ready to restart' },
  zh: { scan:'正在读取用量…',pricing:'正在获取价格…',upload:'正在同步用量…',fetch:'正在获取数据…',login:'等待登录授权…',appCheck:'正在检查 App 更新…',cliCheck:'正在检查 CLI 更新…',cliInstall:'正在更新 CLI…',download:'正在下载更新…',available:'有可用的 App 更新',downloaded:'更新已下载，可以重启安装' },
};

function bytes(value) {
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function fetching(state, label) {
  const zh = state.settings.language === 'zh';
  const progress = state.fetchProgress;
  if (progress?.activeRequests || (progress && !state.pendingRequests)) {
    const count = progress.completedRequests + '/' + progress.totalRequests;
    const size = bytes(progress.receivedBytes) + (progress.totalBytes !== null ? '/' + bytes(progress.totalBytes) : '');
    return { label: label + ' · ' + count + (zh ? ' 请求' : ' requests') + ' · ' + size + (progress.failedRequests ? (zh ? ' · 失败 ' : ' · failed ') + progress.failedRequests : ''), shortLabel: label + ' · ' + count + (zh ? ' 请求' : ' requests'), percent: progress.percent };
  }
  const requests = state.requestProgress || { completed: 0, total: state.pendingRequests || 0 };
  return { label: label + ' · ' + requests.completed + '/' + requests.total + (zh ? ' 请求' : ' requests'), percent: requests.total ? requests.completed / requests.total * 100 : 0 };
}

export function operationProgress(state) {
  const t = labels[state.settings.language] || labels.en;
  const zh = state.settings.language === 'zh';
  if (state.update.status === 'downloading') return { label:t.download, percent:Number.isFinite(state.update.percent) ? Math.max(0,Math.min(100,state.update.percent)) : null };
  if (state.update.status === 'checking') return { label:t.appCheck, percent:0 };
  if (state.cli.updateStatus === 'checking') return fetching(state, t.cliCheck);
  if (state.cli.updateStatus === 'installing') return { label:t.cliInstall, percent:null };
  if (state.loginBusy) return { label:t.login, percent:null };
  if (state.busy) {
    if (state.collectionPhase && state.collectionPhase !== 'scan') return fetching(state, t[state.collectionPhase]);
    const progress = state.scanProgress;
    if (!progress || progress.stage === 'discovery') return { label: (zh ? '正在查找文件 · 已找到 ' : 'Discovering files · found ') + (progress?.discoveredFiles || 0), shortLabel: (zh ? '已发现 ' : 'Found ') + (progress?.discoveredFiles || 0) + (zh ? ' 个文件' : ' files'), percent:0 };
    const count = progress.processedFiles + '/' + progress.totalFiles;
    const phase = progress.stage === 'processing' ? (zh ? '汇总' : 'Summarizing') : (zh ? '读取' : 'Reading');
    return { label:phase + ' · ' + count + (zh ? ' 文件' : ' files') + ' · ' + bytes(progress.readBytes), shortLabel:phase + ' · ' + count + (zh ? ' 文件' : ' files'), percent:progress.percent };
  }
  if (state.pendingRequests || state.fetchProgress?.activeRequests) return fetching(state, t.fetch);
  if (state.update.status === 'downloaded') return { label:t.downloaded, percent:100 };
  if (state.update.status === 'available') return { label:t.available + (state.update.version ? ' · v' + state.update.version : ''), percent:0 };
  return null;
}

export function renderProgress(state) {
  const operation = operationProgress(state);
  const root = document.getElementById('operationProgress');
  root.hidden = !operation;
  document.body.classList.toggle('has-operation-progress', !!operation);
  if (!operation) return;
  const track = document.getElementById('progressTrack');
  document.getElementById('progressLabel').textContent = root.classList.contains('compact-progress') ? operation.shortLabel || operation.label : operation.label;
  root.title = operation.label;
  track.setAttribute('aria-label', operation.label);
  track.classList.toggle('indeterminate', operation.percent === null);
  if (operation.percent === null) track.removeAttribute('aria-valuenow');
  else track.setAttribute('aria-valuenow', String(operation.percent));
  document.getElementById('progressFill').style.width = operation.percent === null ? '48%' : operation.percent + '%';
  document.getElementById('progressPercent').textContent = operation.percent === null ? '' : (operation.percent >= 100 ? 100 : Math.floor(operation.percent)) + '%';
}
