import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import {NetworkProgress} from '../app/network-progress.js';

test('HTTP progress measures streamed bodies, unknown and compressed sizes, errors and cancellation',async()=>{
  const body=Buffer.alloc(128*1024,'x');
  const server=http.createServer((req,res)=>{
    if(req.url==='/gzip'){const compressed=gzipSync(body);res.writeHead(200,{'content-encoding':'gzip','content-length':compressed.length});res.end(compressed);return;}
    if(req.url==='/error'){res.writeHead(503);res.end('unavailable');return;}
    res.writeHead(200,req.url==='/known'?{'content-length':body.length}:{});
    res.write(body.subarray(0,body.length/2));
    const timer=setTimeout(()=>res.end(body.subarray(body.length/2)),150);
    res.on('close',()=>clearTimeout(timer));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+server.address().port;
  const states=[];const meter=new NetworkProgress(p=>states.push(p));
  try{
    assert.equal((await (await meter.fetch(url+'/known',undefined,fetch)).arrayBuffer()).byteLength,body.length);
    assert.ok(states.some(p=>p.percent>0&&p.percent<100&&p.receivedBytes>0&&p.receivedBytes<body.length));
    assert.equal(states.at(-1).receivedBytes,body.length);assert.equal(states.at(-1).percent,100);
    states.length=0;
    const result=await Promise.all(['/chunked','/gzip'].map(p=>meter.fetch(url+p,undefined,fetch)));
    assert.equal(await result[0].text(),body.toString());assert.equal(await result[1].text(),body.toString());
    assert.equal(states.at(-1).totalBytes,null);assert.equal(states.at(-1).totalRequests,2);
    assert.equal(states.at(-1).receivedBytes,body.length*2);assert.equal(states.at(-1).completedRequests,2);
    assert.ok(states.some(p=>p.activeRequests&&p.percent<100));
    await meter.fetch(url+'/error',undefined,fetch);assert.equal(states.at(-1).failedRequests,1);
    const controller=new AbortController();const abort=setTimeout(()=>controller.abort(),50);
    await assert.rejects(meter.fetch(url+'/chunked',{signal:controller.signal},fetch));clearTimeout(abort);
    assert.equal(states.at(-1).activeRequests,0);assert.equal(states.at(-1).failedRequests,1);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
