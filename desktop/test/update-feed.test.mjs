import {test} from 'node:test';
import assert from 'node:assert/strict';
import {load,dump} from 'js-yaml';
import {newestDesktopRelease,updateFeedManifest} from '../scripts/update-feed.mjs';

test('desktop feed selects numeric stable versions and cannot follow CLI or draft releases',()=>{
  const releases=['v0.2.84','desktop-latest','desktop-v0.1.9','desktop-v0.1.21','desktop-v0.1.22','desktop-v0.2.0'].map(tag_name=>({tag_name,draft:tag_name==='desktop-v0.1.22',prerelease:tag_name==='desktop-v0.2.0'}));
  assert.equal(newestDesktopRelease(releases).tag_name,'desktop-v0.1.21');
});

const sha512=Buffer.alloc(64,1).toString('base64');
const name='TokenFlow-0.1.21-mac-arm64.zip';
const manifest={version:'0.1.21',files:[{url:name,sha512,size:1234}],path:name,sha512};
const release={tag_name:'desktop-v0.1.21',assets:[{name,size:1234,state:'uploaded'}]};
test('stable feed retains integrity and resolves downloads to immutable versioned assets',()=>{
  const result=load(updateFeedManifest(dump(manifest),release));
  const url='https://github.com/Renaissance-Mind/TokenFlow/releases/download/desktop-v0.1.21/'+name;
  assert.equal(result.files[0].url,url);assert.equal(result.path,url);
  assert.equal(result.files[0].sha512,sha512);assert.equal(result.files[0].size,1234);
});
test('feed publishing rejects mismatched versions, missing files and unsafe paths',()=>{
  assert.throws(()=>updateFeedManifest(dump({...manifest,version:'0.1.20'}),release));
  assert.throws(()=>updateFeedManifest(dump(manifest),{...release,assets:[]}));
  assert.throws(()=>updateFeedManifest(dump({...manifest,files:[{...manifest.files[0],url:'https://other.example/app.zip'}]}),release));
  assert.throws(()=>updateFeedManifest(dump({...manifest,sha512:'changed'}),release));
});
