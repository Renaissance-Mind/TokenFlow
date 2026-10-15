// The preview has no Electron preload. Settings brokers read-only Dashboard
// requests; all editing controls and saved preferences stay in the parent.
const channel='tokenflow-widget-editor';
let serial=0;
const pending=new Map(),listeners=new Set();
const send=(type,value={})=>parent.postMessage({channel,type,...value},'*');
function rpc(type,value={}){return new Promise((resolve,reject)=>{const id=++serial;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Preview request timed out'));},30000);pending.set(id,{resolve,reject,timer});send(type,{...value,id});});}
window.addEventListener('message',event=>{
  if(event.source!==parent||event.data?.channel!==channel)return;
  const data=event.data;
  if(data.type==='response'){const job=pending.get(data.id);if(!job)return;clearTimeout(job.timer);pending.delete(data.id);data.error?job.reject(new Error(data.error)):job.resolve(data.value);}
  if(data.type==='state'){for(const listener of listeners)listener(data.value);requestAnimationFrame(measure);}
  if(data.type==='layout')requestAnimationFrame(()=>{window.tokenflowDashboard?.repaint();measure();});
  if(data.type==='dragging'){document.body.classList.toggle('is-editing-drag',!!data.value);for(const node of document.querySelectorAll('[data-mini-widget]'))node.classList.toggle('is-dragging',node.dataset.miniWidget===data.value);requestAnimationFrame(measure);}
});
window.tokenflow=Object.freeze({
  getState:async()=>{const state=await rpc('state');requestAnimationFrame(measure);return state;},
  onState:listener=>{listeners.add(listener);return()=>listeners.delete(listener);},
  dashboardRequest:path=>rpc('request',{path}),
  resizeTray:()=>{requestAnimationFrame(measure);return Promise.resolve();},
  saveSettings:()=>Promise.resolve(),scan:()=>Promise.resolve(),dashboard:()=>{},openSettings:()=>{},
});
document.body.classList.add('widget-preview');
const style=document.createElement('link');style.rel='stylesheet';style.href='/editor-preview.css';document.head.append(style);
function measure(){
  const main=document.querySelector('main');if(!document.getElementById('miniWidgets'))return;
  let zone=document.getElementById('editorEndZone');if(!zone){zone=document.createElement('div');zone.id='editorEndZone';main.append(zone);}
  zone.textContent=document.documentElement.lang.startsWith('zh')?'拖到这里，添加组件':'Drop a widget here';
  for(const button of document.querySelectorAll('.mini-header button')){button.tabIndex=-1;button.setAttribute('aria-disabled','true');}
  send('height',{height:Math.ceil(main.getBoundingClientRect().bottom+14),layout:Array.from(document.querySelectorAll('#miniWidgets>[data-mini-widget]'),node=>({widget:node.dataset.miniWidget,top:node.getBoundingClientRect().top,height:node.getBoundingClientRect().height})),end:zone.getBoundingClientRect().top});
  send('values',{cache:document.getElementById('cacheHitRate').textContent,output:document.getElementById('outputTokens').textContent});
  document.body.dataset.editorReady='true';
}
new ResizeObserver(measure).observe(document.body);
send('ready');
