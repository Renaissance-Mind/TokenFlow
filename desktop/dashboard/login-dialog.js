const copy = {
  en: { title:'Sign in to TokenFlow',description:'Your usage, across every device.',choose:'Continue with',github:'Sign in with GitHub',google:'Sign in with Google',close:'Close',local:'Continue locally',cancel:'Cancel sign-in',browser:'Secure sign-in opens in your browser.',starting:'Opening your browser…',waiting:'After signing in, click “Connect this app →” in your browser.',required:'Update the CLI in Settings to sign in.' },
  zh: { title:'登录 TokenFlow',description:'在每台设备上，查看你的用量。',choose:'选择登录方式',github:'通过 GitHub 登录',google:'通过 Google 登录',close:'关闭',local:'继续使用本机数据',cancel:'取消登录',browser:'将在浏览器中安全登录。',starting:'正在打开浏览器…',waiting:'请在浏览器中登录，再点击“Connect this app →”完成授权。',required:'请在设置中更新 CLI 后登录。' },
};

export function createLoginDialog() {
  const $ = id => document.getElementById(id);
  const dialog = $('desktopLoginDialog');
  let state, error = '', submitting = false, attempted = false;
  const label = (id, text) => { $(id).title = text; $(id).setAttribute('aria-label', text); };
  function render() {
    if (!state) return;
    const t = copy[state.settings.language] || copy.en;
    for (const [id,key] of [['Title','title'],['Description','description'],['Choose','choose'],['Browser','browser']]) $('desktopLogin'+id).textContent=t[key];
    const busy = submitting || state.loginBusy;
    for (const [id,key] of [['Github','github'],['Google','google'],['Close','close']]) label('desktopLogin'+id,t[key]);
    $('desktopLoginGithub').disabled = $('desktopLoginGoogle').disabled = busy || !state.cli.compatible;
    $('desktopLoginLocal').textContent = busy ? t.cancel : t.local;
    $('desktopLoginPending').hidden = !busy;
    $('desktopLoginWaiting').textContent = state.login ? t.waiting : t.starting;
    $('desktopLoginCode').hidden = !state.login;
    $('desktopLoginCode').textContent = state.login?.code || '';
    const failure = error || (attempted && !busy ? state.error : '') || (!state.cli.compatible ? t.required : '');
    $('desktopLoginError').textContent = failure;
    $('desktopLoginError').hidden = !failure;
  }
  async function close() {
    // Closing also revokes the pending local authorization flow.
    if (submitting || state?.loginBusy) {
      try { await window.tokenflow.cancelLogin(); }
      catch (cause) { error = cause.message; render(); return; }
    }
    dialog.close();
    $('desktopSignIn').focus();
  }
  async function signIn(provider) {
    if (submitting || state.loginBusy) return;
    submitting = true; attempted = true; error = ''; render();
    try { await window.tokenflow.login(provider); }
    catch (cause) { error = cause.message; }
    finally { submitting = false; render(); }
  }
  $('desktopLoginGithub').onclick = () => void signIn('github');
  $('desktopLoginGoogle').onclick = () => void signIn('google');
  $('desktopLoginClose').onclick = $('desktopLoginLocal').onclick = () => void close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); void close(); });
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) void close();
  });
  return {
    open() { error = ''; attempted = false; render(); if (!dialog.open) dialog.showModal(); },
    update(next) {
      state = next; render();
      if (state.hasDashboard && dialog.open) { dialog.close(); $('desktopRefresh').focus(); }
    },
  };
}
