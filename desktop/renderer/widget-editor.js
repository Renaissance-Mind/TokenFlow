import {widgetCatalog,widgetCopy,defaultWidgets} from './widget-catalog.js';
const $=id=>document.getElementById(id);
const channel='tokenflow-widget-editor';
const words={
  zh:{title:'编辑小窗',subtitle:'拖动组件，排成最顺手的样子。',add:'添加组件',done:'完成',saving:'保存中…',library:'小组件',hint:'点击添加，或拖入左侧',search:'搜索组件…',close:'关闭组件库',reset:'恢复默认',range:'默认时间范围',theme:'外观',count:n=>`${n} 个组件 · 拖动调整顺序`,added:'已添加',addOne:'添加',empty:'没有找到匹配的组件',unsaved:'有未保存的修改',saved:'小窗设置已保存。',failed:'保存失败，请重试。',loading:'正在读取小窗预览…',retry:'重试',required:'至少保留一个组件',restored:'已恢复默认排列，点击完成保存。',preview:'小窗预览',noData:'暂无用量',local:'本机数据',cloud:'同步数据'},
  en:{title:'Edit popup',subtitle:'Drag widgets into a layout that works for you.',add:'Add widgets',done:'Done',saving:'Saving…',library:'Widgets',hint:'Click to add, or drag into the preview',search:'Search widgets…',close:'Close widget library',reset:'Restore defaults',range:'Default time range',theme:'Appearance',count:n=>`${n} widgets · Drag to reorder`,added:'Added',addOne:'Add',empty:'No matching widgets',unsaved:'Unsaved changes',saved:'Popup saved.',failed:'Could not save. Try again.',loading:'Loading popup preview…',retry:'Retry',required:'Keep at least one widget',restored:'Default layout restored. Click Done to save.',preview:'Popup preview',noData:'No usage yet',local:'This device',cloud:'Synced data'},
};
const icon=(name)=>{const img=document.createElement('img');img.src='icons/'+name+'.svg';img.alt='';img.draggable=false;return img;};
export function createWidgetEditor(){
  let latest,draft,dirty=false,active=false,ready=false,saving=false,revision='',summary=null,heatmap=null;
  let open=innerWidth>1100,query='',height=640,dragged=null,dropBefore=null,layout=[],endY=400,pointer=null;
  const requests=new Map(),charts=new Map(),cards=new Map(),handles=new Map();
  const frame=$('widgetPreview');
  const overlay=document.createElement('div');overlay.id='widgetDragOverlay';overlay.hidden=true;
  const marker=document.createElement('div');marker.id='widgetDropMarker';marker.hidden=true;
  $('widgetWorkspace').append(overlay,marker);
  const ghost=document.createElement('div');ghost.id='widgetDragLabel';ghost.hidden=true;$('widgetWorkspace').append(ghost);
  const handleLayer=document.createElement('div');handleLayer.id='widgetHandles';$('widgetCanvas').append(handleLayer);
  function startDrag(widget){
    dragged=widget;post('dragging',widget);$('widgetWorkspace').classList.add('drag-active');
    const box=$('widgetCanvas').getBoundingClientRect();
    Object.assign(overlay.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});overlay.hidden=false;
  }
  function endDrag(){pointer=null;dragged=null;post('dragging',null);ghost.hidden=true;overlay.style.pointerEvents='';overlay.hidden=true;marker.hidden=true;$('widgetWorkspace').classList.remove('drag-active');}
  function showDrop(x,y){
    const area=$('widgetCanvas').getBoundingClientRect();
    const inside=x>=area.left&&x<=area.right&&y>=area.top&&y<=area.bottom;
    marker.hidden=!inside;if(!inside)return false;
    const box=frame.getBoundingClientRect();
    const next=layout.filter(item=>item.widget!==dragged).find(item=>y<box.top+item.top+item.height/2);
    dropBefore=next?.widget||null;
    Object.assign(marker.style,{top:(box.top+(next?next.top:endY)-7)+'px',left:(box.left+51)+'px',width:Math.max(80,box.width-102)+'px'});
    if(y<area.top+65)$('widgetCanvas').scrollBy(0,-18);else if(y>area.bottom-65)$('widgetCanvas').scrollBy(0,18);
    return true;
  }
  function bindPointerDrag(node,widget){
    node.draggable=false;
    node.addEventListener('pointerdown',event=>{
      if(event.button!==0||saving||event.target.closest('.widget-add'))return;
      if(node.classList.contains('widget-library-card')&&draft.trayWidgets.includes(widget))return;
      event.preventDefault();node.setPointerCapture(event.pointerId);pointer={id:event.pointerId,widget,x:event.clientX,y:event.clientY};
    });
  }
  window.addEventListener('pointermove',event=>{
    if(!pointer||event.pointerId!==pointer.id)return;
    if(!dragged&&Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>4){startDrag(pointer.widget);overlay.style.pointerEvents='none';const card=cards.get(pointer.widget).cloneNode(true);card.className='widget-drag-card';card.removeAttribute('hidden');card.querySelector('.widget-add')?.remove();
      const original=cards.get(pointer.widget).querySelector('canvas'),copy=card.querySelector('.widget-thumbnail');
      if(original&&copy){const img=document.createElement('img');img.src=original.toDataURL('image/png');img.alt='';img.className='widget-drag-chart';copy.replaceChildren(img);}
      ghost.replaceChildren(card);ghost.hidden=false;}
    if(dragged){showDrop(event.clientX,event.clientY);Object.assign(ghost.style,{left:(event.clientX+14)+'px',top:(event.clientY+14)+'px'});}
  });
  window.addEventListener('pointerup',event=>{if(!pointer)return;if(dragged&&showDrop(event.clientX,event.clientY))insert(dragged,dropBefore);endDrag();});
  window.addEventListener('pointercancel',endDrag);
  window.addEventListener('keydown',event=>{if(event.key==='Escape')endDrag();});
  overlay.addEventListener('dragover',event=>{if(!dragged)return;event.preventDefault();showDrop(event.clientX,event.clientY);});
  overlay.addEventListener('drop',event=>{event.preventDefault();if(dragged)insert(dragged,dropBefore);endDrag();});
  document.addEventListener('dragend',endDrag);

  function renderHandles(){
    if(!draft)return;
    for(const [name,pair] of handles)if(!draft.trayWidgets.includes(name)){pair.remove();handles.delete(name);}
    for(const row of layout){
      if(!draft.trayWidgets.includes(row.widget))continue;
      let pair=handles.get(row.widget);
      if(!pair){
        pair=document.createElement('div');pair.className='widget-row-controls';
        const handle=document.createElement('button');handle.type='button';handle.draggable=false;handle.className='widget-row-handle';handle.dataset.dragWidget=row.widget;handle.append(icon('move'));
        bindPointerDrag(handle,row.widget);
        handle.onkeydown=event=>{if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();move(row.widget,event.key==='ArrowUp'?-1:1);}};
        const removeButton=document.createElement('button');removeButton.type='button';removeButton.className='widget-row-remove';removeButton.dataset.removeWidget=row.widget;removeButton.append(icon('minus-circle'));removeButton.onclick=()=>remove(row.widget);
        pair.append(handle,removeButton);handleLayer.append(pair);handles.set(row.widget,pair);
      }
      pair.style.top=(frame.offsetTop+row.top+row.height/2)+'px';
      const [handle,removeButton]=pair.children,title=widgetCopy(row.widget,latest.settings.language)[0];
      handle.style.left=(frame.offsetLeft+3)+'px';removeButton.style.left=(frame.offsetLeft+frame.clientWidth-31)+'px';
      handle.title=title+' · '+(latest.settings.language==='zh'?'拖动排序；方向键上移或下移':'Drag to reorder; use arrow keys to move');handle.setAttribute('aria-label',handle.title);
      removeButton.disabled=saving||draft.trayWidgets.length===1;removeButton.title=removeButton.disabled?t().required:(latest.settings.language==='zh'?'移除 ':'Remove ')+title;removeButton.setAttribute('aria-label',removeButton.title);
      handle.disabled=saving;
    }
  }
  const t=()=>words[latest?.settings.language]||words.en;
  function post(type,value){if(ready)frame.contentWindow.postMessage({channel,type,value},'*');}
  function previewState(){return {...latest,settingsOpen:false,settings:{...latest.settings,...draft}};}
  function changed(){dirty=true;$('traySavedStatus').textContent=t().unsaved;render();post('state',previewState());}
  function insert(widget,before=null){
    if(!widgetCatalog.some(item=>item.id===widget))return;
    const next=draft.trayWidgets.filter(item=>item!==widget);const index=before?next.indexOf(before):-1;next.splice(index<0?next.length:index,0,widget);
    if(JSON.stringify(next)===JSON.stringify(draft.trayWidgets))return;
    draft.trayWidgets=next;changed();
  }
  function remove(widget){
    if(draft.trayWidgets.length===1){$('traySavedStatus').textContent=t().required;return;}
    draft.trayWidgets=draft.trayWidgets.filter(item=>item!==widget);changed();
  }
  function move(widget,direction){const index=draft.trayWidgets.indexOf(widget),to=index+direction;if(index<0||to<0||to>=draft.trayWidgets.length)return;const next=[...draft.trayWidgets];[next[index],next[to]]=[next[to],next[index]];draft.trayWidgets=next;changed();}
  function markDrawer(){
    $('widgetWorkspace').classList.toggle('library-open',open);$('widgetLibrary').hidden=!open;$('addWidget').setAttribute('aria-expanded',String(open));
    requestAnimationFrame(()=>{for(const chart of charts.values())chart.resize();});
  }
  function render(){
    if(!draft)return;
    for(const [id,key] of [['widgetEditorTitle','title'],['widgetEditorSubtitle','subtitle'],['widgetLibraryTitle','library'],['widgetLibraryHint','hint'],['resetWidgetsText','reset'],['addWidgetText','add']])$(id).textContent=t()[key];
    $('saveTray').textContent=t()[saving?'saving':'done'];$('saveTray').disabled=saving;
    for(const id of ['trayRange','trayTheme','resetWidgets'])$(id).disabled=saving;
    $('widgetCount').textContent=t().count(draft.trayWidgets.length);
    $('widgetSearch').placeholder=t().search;$('widgetSearch').setAttribute('aria-label',t().search);
    $('closeWidgetLibrary').title=t().close;$('closeWidgetLibrary').setAttribute('aria-label',t().close);
    frame.title=t().preview;$('widgetPreviewLoadingText').textContent=t().loading;$('retryWidgetPreview').textContent=t().retry;
    $('trayRange').setAttribute('aria-label',t().range);$('trayTheme').setAttribute('aria-label',t().theme);
    $('trayRange').value=String(draft.trayRange);$('trayTheme').value=draft.trayTheme;
    for(const item of widgetCatalog){
      const card=cards.get(item.id),copy=widgetCopy(item.id,latest.settings.language),added=draft.trayWidgets.includes(item.id);
      card.querySelector('h4').textContent=copy[0];card.querySelector('.widget-card-hint').textContent=copy[1];
      const button=card.querySelector('button');button.disabled=added||saving;button.title=(added?t().added:t().addOne)+' '+copy[0];button.setAttribute('aria-label',button.title);button.replaceChildren(icon(added?'check':'plus'));
      card.classList.toggle('is-added',added);card.draggable=false;card.setAttribute('aria-label',copy[0]);
      card.hidden=!!query&&!copy.join(' ').toLocaleLowerCase().includes(query);
    }
    $('widgetNoResults').textContent=t().empty;$('widgetNoResults').hidden=[...cards.values()].some(card=>!card.hidden);
    markDrawer();drawThumbnails();renderHandles();
  }
  function makeCards(){for(const item of widgetCatalog){
    const card=document.createElement('article');card.className='widget-library-card';card.dataset.widget=item.id;
    const heading=document.createElement('div');heading.className='widget-card-heading';const title=document.createElement('h4');const add=document.createElement('button');add.type='button';add.className='widget-add';add.onclick=()=>{insert(item.id);if(innerWidth<1100){open=false;markDrawer();}};heading.append(title,add);
    const visual=document.createElement('div');visual.className='widget-thumbnail';visual.dataset.thumbnail=item.id;
    const hint=document.createElement('p');hint.className='widget-card-hint';card.append(heading,visual,hint);
    bindPointerDrag(card,item.id);
    $('widgetCatalog').append(card);cards.set(item.id,card);
  }}
  function drawThumbnails(){
    if(!active||!window.echarts)return;
    const palette=['#1570ef','#ff812c','#009d80','#7e64dd','#aab8cb'];
    const totals=summary?.totals||{};
    const compact=value=>new Intl.NumberFormat(latest?.settings.language==='zh'?'zh-CN':'en',{notation:'compact',maximumFractionDigits:2}).format(Number(value||0));
    const metric=(id,parts)=>{
      const node=cards.get(id).querySelector('.widget-thumbnail');node.replaceChildren();node.classList.add('thumbnail-metrics');
      for(const [label,value] of parts){const part=document.createElement('div'),small=document.createElement('span'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;part.append(small,strong);node.append(part);}
    };
    metric('overview',[['Token',summary?compact(totals.total_tokens):'—'],['USD',summary?'$'+Number(totals.total_cost_usd||0).toFixed(2):'—']]);
    // Headline values come from the canonical renderer (including its model-aware
    // input denominator), rather than introducing a second metric definition.
    metric('cache',[[latest?.settings.language==='zh'?'缓存命中率':'Cache hit rate',$('widgetWorkspace').dataset.cacheValue||'—']]);
    metric('output',[['Token',$('widgetWorkspace').dataset.outputValue||'—']]);
    const days=(heatmap?.days||[]).filter(day=>{const date=new Date();date.setDate(date.getDate()-draft.trayRange+1);return day.date>=date.toLocaleDateString('en-CA');});
    for(const id of ['trend','models','activity','composition','devices']){
      const node=cards.get(id).querySelector('.widget-thumbnail');
      let chart=charts.get(id);if(!chart){chart=echarts.init(node,null,{renderer:'canvas'});charts.set(id,chart);}
      const base={animation:false,color:palette,grid:{left:4,right:8,top:8,bottom:12},xAxis:{show:false,type:'category'},yAxis:{show:false,type:'value'},series:[]};
      if(id==='trend')base.series=[{type:'line',data:days.map(day=>Number(day.total_tokens||0)),smooth:.3,symbol:'none',lineStyle:{width:2},areaStyle:{opacity:.08}}];
      if(id==='models'||id==='devices'){
        const items=(id==='models'?summary?.models:summary?.devices)||[];
        const sorted=items.slice().sort((a,b)=>Number(b.total_cost_usd)-Number(a.total_cost_usd)).slice(0,3).reverse();
        base.grid={left:100,right:6,top:6,bottom:6};base.xAxis={show:false,type:'value'};
        base.yAxis={type:'category',data:sorted.map(item=>item.model||item.device_name||item.name||item.id||'—'),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#64748b',fontSize:10,width:88,overflow:'truncate'}};
        base.series=[{type:'bar',data:sorted.map(item=>Number(item.total_cost_usd||0)),barWidth:8,itemStyle:{borderRadius:3},showBackground:true,backgroundStyle:{color:'#edf1f5',borderRadius:3}}];
      }
      if(id==='composition'){
        base.xAxis={show:false,type:'value'};base.yAxis={show:false,type:'category',data:['Token']};
        base.series=['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens'].map((key,index)=>({type:'bar',stack:'tokens',barWidth:18,data:[Number(totals[key]||0)],itemStyle:{color:palette[index]}}));
      }
      if(id==='activity'){
        const all=(heatmap?.days||[]).slice(-105),max=Math.max(1,...all.map(day=>Number(day.total_tokens||0)));
        base.xAxis={show:false,type:'value',min:-.5,max:14.5};base.yAxis={show:false,type:'value',min:-.5,max:6.5};
        base.series=[{type:'scatter',symbol:'roundRect',symbolSize:[10,4],data:all.map((day,index)=>({value:[Math.floor(index/7),6-index%7],itemStyle:{color:Number(day.total_tokens)>0?'#0d9488':'#e5efed',opacity:Number(day.total_tokens)>0?.25+.75*Number(day.total_tokens)/max:1}}))}];
      }
      const noValues=id==='composition'?base.series.every(series=>series.data.every(value=>!Number(value))):['models','devices'].includes(id)&&!(id==='models'?summary?.models:summary?.devices)?.length;
      if(summary&&noValues){base.graphic={type:'text',left:'center',top:'middle',style:{text:t().noData,fill:'#8290a6',fontSize:10}};}
      if(!summary){base.graphic={type:'text',left:'center',top:'middle',style:{text:t().loading,fill:'#8290a6',fontSize:10}};base.series=[];}
      chart.setOption(base,true);chart.resize();
    }
  }
  async function onMessage(event){
    if(event.source!==frame.contentWindow||event.origin!=='tokenflow://dashboard'||event.data?.channel!==channel)return;
    const data=event.data;const respond=(value,error)=>frame.contentWindow.postMessage({channel,type:'response',id:data.id,value,error},'tokenflow://dashboard');
    try{
      if(data.type==='ready'){ready=true;post('state',previewState());return;}
      if(data.type==='state'){respond(previewState());return;}
      if(data.type==='request'){
        const url=new URL(data.path,'https://tokenflow.local');
        if(url.origin!=='https://tokenflow.local'||!['/api/me','/api/devices','/api/usage/summary','/api/usage/heatmap'].includes(url.pathname))throw new Error('Unsupported preview request');
        const requestKey=revision+'|'+url.pathname+url.search;
        if(!requests.has(requestKey))requests.set(requestKey,window.tokenflow.dashboardRequest(data.path).catch(error=>{requests.delete(requestKey);throw error;}));
        const result=await requests.get(requestKey);respond(result);
        if(requestKey.startsWith(revision+'|')){
          if(url.pathname==='/api/usage/summary'&&url.searchParams.get('from'))summary=result;
          if(url.pathname==='/api/usage/heatmap')heatmap=result;
          drawThumbnails();
        }return;
      }
      if(data.type==='height'){
        if(Array.isArray(data.layout)){layout=data.layout;endY=Number(data.end)||endY;}
        const next=Math.max(180,Math.min(10000,Math.ceil(Number(data.height)||height)));
        if(next!==height){height=next;frame.style.height=height+'px';}renderHandles();
        $('widgetPreviewLoading').hidden=true;return;
      }
      if(data.type==='values'){$('widgetWorkspace').dataset.cacheValue=data.cache;$('widgetWorkspace').dataset.outputValue=data.output;drawThumbnails();return;}
      if(data.type==='patch'){
        if([1,7,30].includes(data.settings?.trayRange)){draft.trayRange=data.settings.trayRange;changed();}return;
      }
      if(saving)return;
      if(data.type==='insert')insert(data.widget,data.before);
      if(data.type==='remove')remove(data.widget);
      if(data.type==='move')move(data.widget,data.direction);
      if(data.type==='dragstart')startDrag(data.widget);
      if(data.type==='dragend')endDrag();
      if(data.type==='scroll'){
        const box=$('widgetCanvas').getBoundingClientRect(),y=frame.getBoundingClientRect().top+Number(data.y);
        if(y<box.top+70)$('widgetCanvas').scrollBy(0,-18);else if(y>box.bottom-70)$('widgetCanvas').scrollBy(0,18);
      }
    }catch(error){if(data.id)respond(undefined,error.message);else $('traySavedStatus').textContent=error.message;}
  }
  window.addEventListener('message',onMessage);
  makeCards();
  $('addWidget').onclick=()=>{open=!open;markDrawer();if(open)$('widgetSearch').focus();};
  $('closeWidgetLibrary').onclick=()=>{open=false;markDrawer();$('addWidget').focus();};
  $('widgetSearch').oninput=()=>{query=$('widgetSearch').value.trim().toLocaleLowerCase();render();};
  $('resetWidgets').onclick=()=>{draft.trayWidgets=[...defaultWidgets];changed();$('traySavedStatus').textContent=t().restored;};
  for(const id of ['trayRange','trayTheme'])$(id).onchange=()=>{draft[id]=id==='trayRange'?Number($(id).value):$(id).value;changed();};
  $('retryWidgetPreview').onclick=()=>{ready=false;requests.clear();frame.src='tokenflow://dashboard/index.html?mode=tray&editor=1';};
  $('trayPreferences').onsubmit=async event=>{
    event.preventDefault();if(saving||!draft)return;saving=true;render();
    const saved=structuredClone(draft);
    try{await window.tokenflow.saveSettings(saved);dirty=false;latest=await window.tokenflow.getState();draft={trayRange:latest.settings.trayRange,trayTheme:latest.settings.trayTheme,trayWidgets:[...latest.settings.trayWidgets]};$('traySavedStatus').textContent=t().saved;post('state',previewState());}
    catch(error){$('traySavedStatus').textContent=t().failed+' '+error.message;}
    finally{saving=false;render();}
  };
  new ResizeObserver(()=>{for(const chart of charts.values())chart.resize();renderHandles();}).observe($('widgetCanvas'));
  return {
    update(state){
      const languageChanged=latest&&latest.settings.language!==state.settings.language;
      latest=state;if(languageChanged&&dirty)$('traySavedStatus').textContent=t().unsaved;
      const key=JSON.stringify([state.dashboardSource,state.account?.id,state.summary?.scannedAt,state.lastSyncAt,state.settings.serverUrl]);
      if(key!==revision){revision=key;requests.clear();summary=null;heatmap=null;delete $('widgetWorkspace').dataset.cacheValue;delete $('widgetWorkspace').dataset.outputValue;}
      if(!dirty&&!saving)draft={trayRange:state.settings.trayRange,trayTheme:state.settings.trayTheme,trayWidgets:[...state.settings.trayWidgets]};
      render();if(active)post('state',previewState());
    },
    setActive(value){active=value;document.body.classList.toggle('editing-tray',active);if(!active)return;
      if(!frame.getAttribute('src'))frame.src='tokenflow://dashboard/index.html?mode=tray&editor=1';
      render();post('state',previewState());requestAnimationFrame(()=>post('layout'));
    },
  };
}
