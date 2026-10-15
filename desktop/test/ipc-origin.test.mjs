import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sameRendererLocation } from '../app/ipc-origin.js';

test('renderer trust resolves real directory aliases and rejects other pages', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-origin-'));
  try {
    const application = path.join(root,'Token Flow');
    await fs.mkdir(path.join(application,'renderer'),{recursive:true});
    const expected = path.join(application,'renderer','index.html');
    await fs.writeFile(expected,'');
    const alias = path.join(root,'alias');
    await fs.symlink(application,alias,process.platform === 'win32' ? 'junction' : 'dir');
    assert.equal(sameRendererLocation(pathToFileURL(expected).href+'?mode=tray',expected),true);
    assert.equal(sameRendererLocation(pathToFileURL(path.join(alias,'renderer','index.html')).href,expected),true);
    assert.equal(sameRendererLocation('https://example.com/renderer/index.html',expected),false);
    assert.equal(sameRendererLocation('tokenflow://dashboard/index.html?mode=dashboard',expected),true);
    assert.equal(sameRendererLocation('tokenflow://dashboard/other.html',expected),false);
    assert.equal(sameRendererLocation('tokenflow://elsewhere/index.html',expected),false);
    assert.equal(sameRendererLocation(pathToFileURL(path.join(application,'renderer','other.html')).href,expected),false);
    await fs.mkdir(path.join(root,'other','renderer'),{recursive:true});
    assert.equal(sameRendererLocation(pathToFileURL(path.join(root,'other','renderer','index.html')).href,expected),false);
  } finally { await fs.rm(root,{recursive:true,force:true}); }
});
