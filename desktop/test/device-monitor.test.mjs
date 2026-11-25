import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DeviceMonitor,deviceUsageVersion} from '../app/device-monitor.js';

const device=(id,usage_revision,last_sync_at)=>({id,name:id,platform:'darwin',revoked_at:null,status:'active',last_sync_at,usage_revision});
test('versioned snapshots ignore heartbeats, while legacy devices and pricing retain independent change signals',()=>{
  const one=device('one','revision-a','12:00'), old=device('old',undefined,'12:00');
  const version=(devices,price='catalog-a')=>deviceUsageVersion({devices},price);
  assert.equal(version([one,old]),version([old,{...one,last_sync_at:'12:10'}]));
  for(const field of [{usage_revision:'revision-b'},{name:'renamed'},{revoked_at:'12:10'}])
    assert.notEqual(version([one,old]),version([{...one,...field},old]));
  assert.notEqual(version([one,old]),version([one,{...old,last_sync_at:'12:10'}]));
  assert.notEqual(version([one,old]),version([one]));
  assert.notEqual(version([one,old]),version([one,old],'catalog-b'));
});

test('one device read serves concurrent readers, resets do not accept old reads, and only confirmed reads become fresh',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'tokenflow-device-monitor-'));
  try{
    const file=path.join(dir,'devices.json'), monitor=new DeviceMonitor(),accepted=[];
    const load=async()=>({list:JSON.parse(await readFile(file,'utf8')),pricingVersion:'catalog'});
    const accept=(list,usage,metadata)=>accepted.push([list.devices[0].id,usage,metadata]);
    await writeFile(file,JSON.stringify({devices:[device('one','a','12:00')]}));
    monitor.useScope('first server and account');
    const first=monitor.read(load,accept,100);
    assert.equal(first,monitor.read(load,accept,101));
    assert.equal(monitor.nextCheck(true),undefined);
    await first;
    assert.equal(monitor.nextCheck(true),60100);
    assert.equal(monitor.nextCheck(false),300100);
    assert.equal(monitor.fresh(60099).devices[0].id,'one');
    assert.equal(monitor.fresh(60100),undefined);
    await writeFile(file,JSON.stringify({devices:[device('one','a','12:10')]}));
    await monitor.read(load,accept,60100);
    await writeFile(file,JSON.stringify({devices:[device('one','b','12:11')]}));
    await monitor.read(load,accept,120100);
    const obsolete=monitor.read(load,accept,180100);
    monitor.useScope('different account');
    await obsolete;
    assert.equal(monitor.current,undefined);
    assert.deepEqual(accepted,[['one',false,true],['one',false,true],['one',true,true]]);
    await rm(file);const failed=monitor.read(load,accept,180101);
    await assert.rejects(failed,{code:'ENOENT'});
    assert.equal(monitor.read(load,accept,180102),failed);
    assert.equal(monitor.fresh(180102),undefined);
  }finally{await rm(dir,{recursive:true,force:true});}
});
