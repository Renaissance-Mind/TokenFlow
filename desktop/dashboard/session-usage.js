const words = {
  en: {
    open: 'Codex sessions', title: 'Codex sessions on this device', close: 'Close',
    today: 'Today', week: 'Last 7 days', month: 'Last 30 days', from: 'From', to: 'Through', apply: 'View',
    sessions: 'Sessions', projects: 'Projects', tokens: 'Tokens', costUsd: 'Estimated cost', project: 'Project path',
    session: 'Session', lastUsed: 'Last activity', unknownProject: 'Unknown path', unknownSession: 'Unknown session',
    parent: 'Parent', sort: 'Sort by', searchSessions: 'Search title, ID or path', searchProjects: 'Search project paths',
    loading: 'Reading Codex usage…', empty: 'No recorded Codex usage in this range.', noMatches: 'No matches.',
    scanned: date => `Collected ${date}`,
    invalidRange: 'Choose an end date on or after the start date.', failed: 'Could not read Codex usage.',
    unpriced: n => `${n} tokens have no price.`, skipped: n => `Skipped records in ${n} Codex logs.`,
    previous: 'Previous', next: 'Next', removeFilter: 'Clear project filter',
  },
  zh: {
    open: 'Codex 会话', title: '本机 Codex 会话', close: '关闭',
    today: '今天', week: '最近 7 天', month: '最近 30 天', from: '开始日期', to: '结束日期', apply: '查看',
    sessions: '会话', projects: '项目', tokens: 'Tokens', costUsd: '估算费用', project: '项目路径',
    session: '会话', lastUsed: '最近活动', unknownProject: '路径未知', unknownSession: '会话未知',
    parent: '父会话', sort: '排序依据', searchSessions: '搜索标题、ID 或路径', searchProjects: '搜索项目路径',
    loading: '正在读取 Codex 用量…', empty: '这段时间没有 Codex 用量记录。', noMatches: '没有匹配项。',
    scanned: date => `采集于 ${date}`,
    invalidRange: '结束日期须在开始日期当天或之后。', failed: '无法读取 Codex 用量。',
    unpriced: n => `${n} 个 token 暂无价格。`, skipped: n => `${n} 份 Codex 日志含跳过的记录。`,
    previous: '上一页', next: '下一页', removeFilter: '清除项目筛选',
  },
};

const pageSize = 40;

export function createSessionUsage(request) {
  const trigger = document.createElement('button');
  trigger.className = 'session-usage-trigger';
  trigger.type = 'button';
  trigger.hidden = true;
  trigger.setAttribute('aria-haspopup', 'dialog');
  document.getElementById('desktopSettings').before(trigger);

  const dialog = document.createElement('dialog');
  dialog.className = 'session-usage';
  dialog.setAttribute('aria-labelledby', 'sessionUsageTitle');
  dialog.innerHTML = `
    <header class="session-usage-heading">
      <h2 id="sessionUsageTitle" data-label="title"></h2>
      <button type="button" class="session-usage-close" data-close autofocus>×</button>
    </header>
    <form class="session-usage-range">
      <div class="session-usage-presets">
        <button type="button" data-days="1" data-label="today"></button>
        <button type="button" data-days="7" data-label="week"></button>
        <button type="button" data-days="30" data-label="month"></button>
      </div>
      <label><span data-label="from"></span><input name="from" type="date" required></label>
      <label><span data-label="to"></span><input name="to" type="date" required></label>
      <button type="submit" data-label="apply"></button>
    </form>
    <dl class="session-usage-totals" hidden>
      <div><dt data-label="sessions"></dt><dd data-total="sessions"></dd></div>
      <div><dt data-label="projects"></dt><dd data-total="projects"></dd></div>
      <div><dt data-label="tokens"></dt><dd data-total="tokens"></dd></div>
      <div><dt data-label="costUsd"></dt><dd data-total="costUsd"></dd></div>
    </dl>
    <p class="session-usage-note" hidden></p>
    <div class="session-usage-controls" hidden>
      <div class="session-usage-views" role="group">
        <button type="button" data-view="sessions" data-label="sessions"></button>
        <button type="button" data-view="projects" data-label="projects"></button>
      </div>
      <input name="search" type="search" autocomplete="off" spellcheck="false">
      <select name="sort">
        <option value="costUsd" data-label="costUsd"></option>
        <option value="totalTokens" data-label="tokens"></option>
      </select>
      <button type="button" class="session-usage-filter" data-filter hidden></button>
    </div>
    <p class="session-usage-status" role="status" hidden></p>
    <div class="session-usage-scroll" tabindex="0" hidden>
      <table><thead></thead><tbody></tbody></table>
    </div>
    <footer class="session-usage-pages" hidden>
      <span data-page-info></span>
      <button type="button" data-page="-1" data-label="previous"></button>
      <button type="button" data-page="1" data-label="next"></button>
    </footer>`;
  document.body.append(dialog);

  const find = selector => dialog.querySelector(selector);
  const from = find('[name=from]'), to = find('[name=to]');
  const search = find('[name=search]'), sort = find('[name=sort]');
  const status = find('.session-usage-status'), close = find('[data-close]');
  const scroll = find('.session-usage-scroll'), filter = find('[data-filter]');
  const headings = find('thead'), body = find('tbody');
  const ranges = [...dialog.querySelectorAll('[data-days]')];
  const views = [...dialog.querySelectorAll('[data-view]')];
  const pages = [...dialog.querySelectorAll('[data-page]')];
  let language, t = words.en, reportingDate, preset, report, dataRevision, loadedRevision;
  let enabled = false, loading = false, requestId = 0, view = 'sessions', projectFilter, page = 0, error = '';

  function localize(value) {
    language = value;
    t = words[language] || words.en;
    trigger.textContent = t.open;
    close.setAttribute('aria-label', t.close);
    sort.setAttribute('aria-label', t.sort);
    filter.setAttribute('aria-label', t.removeFilter);
    scroll.setAttribute('aria-label', t.title);
    for (const element of dialog.querySelectorAll('[data-label]')) element.textContent = t[element.dataset.label];
    render();
  }

  function render() {
    for (const button of ranges) button.setAttribute('aria-pressed', String(Number(button.dataset.days) === preset));
    for (const input of [...ranges, from, to, find('[type=submit]')]) input.disabled = loading;
    find('.session-usage-totals').hidden = !report;
    find('.session-usage-controls').hidden = !report?.sessions.length;
    const note = find('.session-usage-note');
    note.hidden = true;
    status.hidden = false;
    scroll.hidden = true;
    const pager = find('.session-usage-pages');
    pager.hidden = true;
    if (!report) {
      headings.replaceChildren();
      body.replaceChildren();
      status.textContent = loading ? t.loading : error === 'range' ? t.invalidRange : error ? `${t.failed} ${error}` : '';
      status.hidden = !status.textContent;
      return;
    }

    const locale = language === 'zh' ? 'zh-CN' : 'en';
    const number = new Intl.NumberFormat(locale);
    const money = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' });
    const smallMoney = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
    const date = new Intl.DateTimeFormat(locale, { timeZone: report.timeZone, dateStyle: 'short', timeStyle: 'short' });
    const cost = row => {
      if (row.costUsd === null) return '—';
      const usd = Number(row.costUsd);
      return (usd > 0 && usd < .01 ? smallMoney : money).format(usd);
    };
    const path = row => row.projectPath ?? t.unknownProject;
    const setTotal = (name, text) => { find(`[data-total=${name}]`).textContent = text; };
    setTotal('sessions', number.format(report.sessions.length));
    setTotal('projects', number.format(report.projects.filter(row => row.projectPath !== null).length));
    setTotal('tokens', number.format(report.totals.totalTokens));
    setTotal('costUsd', cost(report.totals));
    note.textContent = [
      t.scanned(date.format(new Date(report.scannedAt))),
      report.totals.unpricedTokens ? t.unpriced(number.format(report.totals.unpricedTokens)) : '',
      report.skippedLogs ? t.skipped(number.format(report.skippedLogs)) : '',
    ].filter(Boolean).join(' · ');
    note.hidden = false;
    for (const button of views) button.setAttribute('aria-pressed', String(button.dataset.view === view));
    search.placeholder = view === 'sessions' ? t.searchSessions : t.searchProjects;
    search.setAttribute('aria-label', search.placeholder);
    filter.hidden = view !== 'sessions' || projectFilter === undefined;
    filter.textContent = filter.hidden ? '' : `${projectFilter ?? t.unknownProject} ×`;
    const query = search.value.trim().toLocaleLowerCase();
    const projects = view === 'projects';
    const rows = report[view].filter(row =>
      (projects || projectFilter === undefined || row.projectPath === projectFilter) &&
      [path(row), row.title, row.sessionId, row.parentSessionId].some(value => value?.toLocaleLowerCase().includes(query))
    ).sort((a, b) => Number(b[sort.value]) - Number(a[sort.value]));

    if (!rows.length) {
      body.replaceChildren();
      status.textContent = report.sessions.length ? t.noMatches : t.empty;
      return;
    }
    status.hidden = true;
    const labels = projects ? ['project', 'sessions', 'tokens', 'costUsd'] : ['session', 'project', 'tokens', 'costUsd', 'lastUsed'];
    const header = document.createElement('tr');
    for (const label of labels) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = t[label];
      if (['tokens', 'costUsd', 'sessions'].includes(label)) cell.className = 'session-usage-number';
      header.append(cell);
    }
    headings.replaceChildren(header);
    const start = page * pageSize;
    body.replaceChildren();
    for (const row of rows.slice(start, start + pageSize)) {
      const line = body.insertRow();
      if (projects) {
        const link = document.createElement('button');
        link.className = 'session-usage-project';
        link.type = 'button';
        link.textContent = path(row);
        link.onclick = () => {
          view = 'sessions';
          projectFilter = row.projectPath;
          search.value = '';
          resetPage();
          search.focus();
        };
        line.insertCell().append(link);
        const count = line.insertCell();
        count.className = 'session-usage-number';
        count.textContent = number.format(row.sessionCount);
      } else {
        const cell = line.insertCell();
        const title = document.createElement('strong');
        title.textContent = row.title || row.sessionId || t.unknownSession;
        if (row.models?.length) title.title = row.models.join(', ');
        cell.append(title);
        if (row.title && row.sessionId) {
          const id = document.createElement('code');
          id.textContent = row.sessionId;
          cell.append(id);
        }
        if (row.parentSessionId) {
          const parent = document.createElement('small');
          parent.textContent = `${t.parent} ${row.parentSessionId}`;
          cell.append(parent);
        }
        line.insertCell().textContent = path(row);
      }
      const tokens = line.insertCell();
      tokens.className = 'session-usage-number';
      tokens.textContent = number.format(row.totalTokens);
      const estimated = line.insertCell();
      estimated.className = 'session-usage-number';
      estimated.textContent = cost(row);
      if (row.unpricedTokens) {
        const detail = document.createElement('small');
        detail.textContent = t.unpriced(number.format(row.unpricedTokens));
        estimated.append(detail);
      }
      if (!projects) line.insertCell().textContent = date.format(new Date(row.lastUsedAt));
    }
    scroll.hidden = false;
    pager.hidden = rows.length <= pageSize;
    find('[data-page-info]').textContent = `${number.format(start + 1)}–${number.format(Math.min(start + pageSize, rows.length))} / ${number.format(rows.length)}`;
    pages[0].disabled = page === 0;
    pages[1].disabled = start + pageSize >= rows.length;
  }

  function resetPage() {
    page = 0;
    scroll.scrollTop = 0;
    render();
  }

  async function load() {
    if (loading || !enabled) return;
    const id = ++requestId;
    const revision = dataRevision;
    report = undefined;
    error = '';
    if (!from.value || !to.value || from.value > to.value) {
      error = 'range';
      render();
      return;
    }
    loading = true;
    projectFilter = undefined;
    resetPage();
    try {
      const result = await request(from.value, to.value);
      if (id === requestId) {
        report = result;
        loadedRevision = revision;
      }
    } catch (failure) {
      if (id === requestId) error = String(failure.message || failure).replace(/^Error invoking remote method 'tokenflow:session-usage': Error: /, '');
    } finally {
      if (id === requestId) {
        loading = false;
        render();
      }
    }
  }

  function selectRange(days) {
    preset = days;
    const end = new Date(`${reportingDate}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1 - days);
    from.value = end.toISOString().slice(0, 10);
    to.value = reportingDate;
    void load();
  }

  trigger.onclick = () => {
    dialog.showModal();
    if (!to.value || (preset && to.value !== reportingDate)) selectRange(preset || 7);
    else if (!report || loadedRevision !== dataRevision) void load();
  };
  close.onclick = () => dialog.close();
  for (const button of ranges) button.onclick = () => selectRange(Number(button.dataset.days));
  for (const input of [from, to]) input.oninput = () => {
    preset = report = undefined;
    error = '';
    render();
  };
  find('form').onsubmit = event => { event.preventDefault(); void load(); };
  for (const button of views) button.onclick = () => {
    view = button.dataset.view;
    projectFilter = undefined;
    resetPage();
  };
  filter.onclick = () => { projectFilter = undefined; resetPage(); search.focus(); };
  search.oninput = resetPage;
  sort.onchange = resetPage;
  for (const button of pages) button.onclick = () => {
    page += Number(button.dataset.page);
    scroll.scrollTop = 0;
    render();
  };
  localize('en');

  return {
    update(state) {
      reportingDate = state.reportingDate || new Date().toLocaleDateString('en-CA');
      dataRevision = state.localUsageRevision;
      const allow = state.settings.showSessionUsage === true;
      if (enabled && !allow) {
        requestId++;
        report = undefined;
        error = '';
        loading = false;
        search.value = '';
        from.value = to.value = '';
        preset = projectFilter = undefined;
        view = 'sessions';
        if (dialog.open) dialog.close();
        render();
      }
      enabled = allow;
      trigger.hidden = !allow;
      if (language !== state.settings.language) localize(state.settings.language);
    },
  };
}
