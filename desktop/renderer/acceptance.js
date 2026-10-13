if(window.__TOKENFLOW_ACCEPTANCE__){
  (async()=>{
    const invoke=window.__TAURI__.core.invoke;
    const probe=(action,payload=null)=>invoke('acceptance_probe',{action,payload});
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const checks=[];
    const check=(condition,message)=>{if(!condition)throw new Error(message);checks.push(message);};
    async function waitState(predicate){for(let i=0;i<600;i++){const state=await window.tokenflow.getState();if(state?.error)throw new Error(state.error);if(predicate(state))return state;await delay(100);}const s=await window.tokenflow.getState();throw new Error('Desktop state timed out '+JSON.stringify({busy:s?.busy,hasCollector:s?.hasCollector,hasDashboard:s?.hasDashboard,hasSummary:!!s?.summary,login:!!s?.login}));}
    try{
      let state=await waitState(value=>value?.summary && !value.busy);
      const phase=window.__TOKENFLOW_ACCEPTANCE__.phase;
      if(phase==='basic'){
        check(!state.hasCollector && state.summary.today.tokens===0,'isolated local summary');
        check(!!document.getElementById('github') && document.getElementById('sync').disabled,'onboarding controls');
        await window.tokenflow.saveSettings({deviceName:'Tauri acceptance',language:'zh',launchAtLogin:false});await delay(150);
        check(document.getElementById('connectTitle').textContent==='一个账号，连接所有设备。','language preference');
        await window.tokenflow.scan();await waitState(value=>!value.busy);checks.push('bundled collector scan');
        try{await window.tokenflow.checkUpdate();}catch(error){const update=await window.tokenflow.getState();if(update.update.status!=="error")throw error;}state=await window.tokenflow.getState();check(['current','available','error'].includes(state.update.status),'native update check');
        const tray=await probe('tray');check(tray.visible && tray.closeHides,'tray popup and window residency');
        if(window.__TOKENFLOW_ACCEPTANCE__.systemTest){
          await window.tokenflow.saveSettings({launchAtLogin:true});check(await probe('startup'),'system startup enabled');
          await window.tokenflow.saveSettings({launchAtLogin:false});check(!await probe('startup'),'system startup disabled');
        }
      }else{
        if(phase==='auth'){
          await window.tokenflow.saveSettings({launchAtLogin:false});
          checks.push('preferences saved');await window.tokenflow.login('google');checks.push('login started');state=await waitState(value=>!!value.login);
          await probe('progress',{code:state.login.code});
        }
        state=await waitState(value=>value?.hasDashboard && value.hasCollector && !value.busy);
        check(state.account?.name==='Desktop acceptance','authenticated account');
        let proof;
        for(let i=0;i<100;i++){proof=await probe('dashboard');if(proof.page.ready && ["denied","unavailable"].includes(proof.page.ipc))break;await delay(150);}
        check(proof.httpOnly && proof.page.ready && proof.page.localBridge==='undefined' && proof.page.location.includes('/dashboard') && ['denied','unavailable'].includes(proof.page.ipc),'authenticated dashboard and privilege boundary');
        if(phase==='auth'){
          await window.tokenflow.saveSettings({paused:true});await window.tokenflow.sync();
          state=await waitState(value=>!value.busy);check(state.settings.paused && !!state.lastSyncAt,'manual sync while paused');
          const headless=await probe('headless');check(headless.success && headless.ownerPreserved,'scheduled collector yields to resident app');
          await probe('stage_recovery');checks.push('credential recovery journal staged');
        }else if(phase==='logout'){
          check(state.settings.paused,'restored settings');await probe('dashboard_logout');
          state=await waitState(value=>!value.hasDashboard && !value.hasCollector);check(!state.hasCollector && !state.hasDashboard,'logout clears local authorization');
        }
      }
      await invoke('acceptance_report',{report:{ok:true,framework:'tauri',version:state.version,collectorVersion:state.collectorVersion,checks}});
    }catch(error){await invoke('acceptance_report',{report:{ok:false,error:String(error?.message || error),checks}});}
  })();
}
