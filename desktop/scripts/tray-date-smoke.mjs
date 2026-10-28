import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron as electron, expect as baseExpect} from '@playwright/test';

const expect=baseExpect.configure({timeout:30_000});
const desktop=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-tray-dates-'));
const env={...process.env,TOKENFLOW_HOME:path.join(root,'collector'),TOKENFLOW_DESKTOP_DATA:path.join(root,'app'),TOKENFLOW_SCAN_HOME:path.join(root,'sources'),TOKENFLOW_CLI_PATH:path.resolve(desktop,'../dist/cli.js'),TOKENFLOW_NODE_PATH:process.execPath};
delete env.ELECTRON_RUN_AS_NODE;
for(const key of Object.keys(env))if(/^(CODEX_HOME|CLAUDE_HOME|GEMINI_HOME|GEMINI_DATA_DIR|OPENCODE_HOME|OPENCODE_DB|KIMI_DATA_DIR|QWEN_DATA_DIR|AMP_DATA_DIR|CODEBUFF_DATA_DIR|DROID_SESSIONS_DIR|GOOSE_PATH_ROOT|HERMES_HOME|KILO_DATA_DIR|OPENCLAW_DIR|PI_AGENT_DIR|DSH_DATA_DIR|GROK_HOME|ZCODE_HOME|COPILOT_HOME|COPILOT_OTEL_FILE_EXPORTER_PATH|ANTIGRAVITY_DATA_DIR|TOKENFLOW_SERVER_URL|TOKENUSAGE_SERVER_URL|TOKENUSAGE_HOME)$/.test(key))delete env[key];
const now=new Date();
const localDay=offset=>new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()+offset)).toISOString().slice(0,10);
const pageTime=offset=>new Date(now.getFullYear(),now.getMonth(),now.getDate()+offset,0,30);
// Real source files go through the bundled parser, collector and Dashboard API.
// Distinct daily totals make a stale date visible in both the number and chart.
for(const [offset,input] of [[-6,500],[0,1000]]){
  const file=path.join(env.TOKENFLOW_SCAN_HOME,'.codex','sessions',`day-${offset}.jsonl`);
  await fs.mkdir(path.dirname(file),{recursive:true});
  const rows=[
    {type:'session_meta',payload:{id:`date-rollover-${offset}`}},
    {type:'turn_context',payload:{model:'gpt-5.2-codex'}},
    {type:'event_msg',timestamp:localDay(offset)+'T00:05:00.000Z',payload:{type:'token_count',info:{total_token_usage:{input_tokens:input,cached_input_tokens:0,output_tokens:input/10,total_tokens:input*1.1}}}},
  ];
  await fs.writeFile(file,rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
}
let instance;
try{
  instance=await electron.launch({args:[desktop],env,timeout:60_000});
  const dashboard=await instance.firstWindow();
  await dashboard.waitForURL(/mode=dashboard$/);
  await expect.poll(async()=>{const state=await dashboard.evaluate(()=>window.tokenflow.getState());if(state.error)throw new Error(state.error);return !!state.summary&&!state.busy;}).toBe(true);
  await dashboard.evaluate(()=>window.tokenflow.saveSettings({trayRange:1}));
  await instance.evaluate(({Menu})=>Menu.getApplicationMenu().getMenuItemById('status-panel').click());
  await expect.poll(()=>instance.windows().some(page=>page.url().includes('mode=tray'))).toBe(true);
  const panel=instance.windows().find(page=>page.url().includes('mode=tray'));
  await panel.waitForLoadState('domcontentloaded');
  const errors=[];panel.on('pageerror',error=>errors.push(error.message));
  await expect(panel.locator('body')).toHaveAttribute('data-mini-loaded','true');
  const assertRange=async(offset,days,tokens)=>{
    const to=localDay(offset),from=localDay(offset-days+1);
    await expect.poll(()=>panel.evaluate(()=>({from:dashboardSummaryPayload?.from.slice(0,10),to:dashboardSummaryPayload?.to.slice(0,10),chartTo:dailyTrendPayload?.to}))).toEqual({from,to,chartTo:to});
    await expect(panel.locator('#totalTokens')).toHaveAttribute('title',new Intl.NumberFormat('en-US').format(tokens));
    const view=await panel.evaluate(()=>({
      summary:Number(dashboardSummaryPayload.totals.total_tokens),
      cost:Number(dashboardSummaryPayload.totals.total_cost_usd),
      modelCost:dashboardSummaryPayload.models.reduce((sum,model)=>sum+Number(model.total_cost_usd),0),
      chart:dailyTrendChart.getOption().series[0].data,
      dates:dailyTrendChart.getOption().xAxis[0].data,
      requestTo:heatmapParams().get('to'),
    }));
    assert.equal(view.requestTo,to);
    assert.equal(view.dates.length,days);assert.equal(view.dates[0],from);assert.equal(view.dates.at(-1),to);
    assert.equal(view.chart.reduce((sum,value)=>sum+value,0),view.summary);
    assert.ok(Math.abs(view.cost-view.modelCost)<0.000001);
  };
  // Start the page six days ago, then keep that same document alive as the
  // renderer's date advances. Native APIs and usage responses remain real.
  await panel.clock.setFixedTime(pageTime(-6));
  await panel.reload();
  await expect(panel.locator('body')).toHaveAttribute('data-mini-loaded','true');
  await assertRange(-6,1,550);
  await panel.clock.setFixedTime(pageTime(0));
  await instance.evaluate(({BrowserWindow,Menu})=>{
    BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().includes('mode=tray')).hide();
    Menu.getApplicationMenu().getMenuItemById('status-panel').click();
  });
  await assertRange(0,1,1100);
  for(const days of [7,30]){
    await panel.locator(`[data-mini-range="${days}"]`).click();
    await assertRange(0,days,1650);
  }
  await panel.locator('[data-mini-range="1"]').click();
  await assertRange(0,1,1100);
  await panel.clock.setFixedTime(pageTime(1));
  await panel.locator('#miniRefresh').click();
  await assertRange(1,1,0);
  // Moving the clock back also refreshes after focus, as when the timezone
  // changes during sleep. The startup Date remains six days old throughout.
  await panel.clock.setFixedTime(pageTime(0));
  await panel.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await assertRange(0,1,1100);
  assert.deepEqual(errors,[]);
  console.log('Tray date regression passed: six-day rollover, reopen, 1/7/30-day totals, midnight refresh, focus and matching chart dates.');
}finally{
  if(instance)await instance.close();
  await fs.rm(root,{recursive:true,force:true});
}
