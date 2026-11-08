import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DashboardRequests} from '../app/dashboard-requests.js';

test('menu, popup and Dashboard share one in-flight request and one freshness interval', async()=>{
  const requests=new DashboardRequests(100);
  requests.useScope('account-one|cloud|Asia/Shanghai');
  let resolve,calls=0;
  const read=()=>{calls++;return new Promise(done=>{resolve=done;});};
  const menu=requests.read('today',read,0),popup=requests.read('today',read,1);
  assert.equal(menu,popup);assert.equal(calls,1);
  resolve({total:'549.24'});
  assert.deepEqual(await popup,{total:'549.24'});
  assert.equal(requests.read('today',read,99),menu);
  const newer=requests.read('today',read,100);
  assert.notEqual(newer,menu);resolve({total:'600.00'});
  assert.deepEqual(await newer,{total:'600.00'});
});

test('account/source/date/timezone changes discard old requests and explicit refresh retries errors', async()=>{
  const requests=new DashboardRequests();
  let finishOld;
  requests.useScope('first-account|cloud|2026-11-08|Asia/Shanghai');
  const old=requests.read('today',()=>new Promise(resolve=>{finishOld=resolve;}));
  requests.useScope('second-account|local|2026-11-09|America/New_York');
  const current=requests.read('today',async()=>({total:'20'}));
  finishOld({total:'999'});
  await old;assert.deepEqual(await current,{total:'20'});
  assert.equal(requests.read('today',()=>{throw new Error('must use current');}),current);
  requests.invalidate();
  await assert.rejects(requests.read('today',async()=>{throw new Error('offline');}),/offline/);
  requests.invalidate();
  assert.deepEqual(await requests.read('today',async()=>({total:'21'})),{total:'21'});
});
