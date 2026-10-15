import {test} from 'node:test';
import assert from 'node:assert/strict';
import {operationProgress} from '../renderer/progress.js';
const state={settings:{language:'en'},update:{status:'idle'},cli:{updateStatus:'idle'},pendingRequests:0,busy:null,loginBusy:false};
test('local reading exposes measured file counts and percentage, including discovery and aggregation',()=>{
  assert.equal(operationProgress(state),null);
  const scan=operationProgress({...state,busy:'scan',scanProgress:{stage:'reading',processedFiles:12,totalFiles:40,readBytes:1048576,percent:31.5}});
  assert.match(scan.label,/12\/40 files/);assert.match(scan.label,/1.0 MB/);assert.equal(scan.percent,31.5);
  assert.equal(operationProgress({...state,busy:'scan',scanProgress:{stage:'discovery',discoveredFiles:26}}).percent,0);
  assert.match(operationProgress({...state,busy:'scan',scanProgress:{stage:'processing',processedFiles:40,totalFiles:40,readBytes:1048576,percent:100}}).label,/Summarizing/);
});
test('fetching reports actual requests and received bytes; download uses updater measurement',()=>{
  const measured={activeRequests:2,completedRequests:1,totalRequests:3,receivedBytes:1536,totalBytes:null,percent:100/3,failedRequests:0};
  const fetch=operationProgress({...state,fetchProgress:measured});assert.match(fetch.label,/1\/3 requests.*1.5 KB/);assert.equal(fetch.percent,100/3);
  assert.ok(Math.abs(operationProgress({...state,pendingRequests:2,requestProgress:{completed:1,total:3}}).percent-100/3)<1e-10);
  assert.equal(operationProgress({...state,update:{status:'downloading',percent:37.4}}).percent,37.4);
  assert.equal(operationProgress({...state,update:{status:'downloading'}}).percent,null);
  assert.equal(operationProgress({...state,update:{status:'downloaded'}}).percent,100);
  assert.equal(operationProgress({...state,loginBusy:true}).percent,null);
});
