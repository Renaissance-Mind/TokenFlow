import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CloudDashboardCache } from '../app/cloud-dashboard-cache.js';

test('cloud Dashboard responses survive restart and stay within one account and server', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenflow-cloud-cache-'));
  const file = path.join(directory, 'cloud-dashboard-cache.json');
  try {
    const first = new CloudDashboardCache(file);
    const response = { totals: { total_tokens: '123' } };
    assert.equal(await first.put('server-a|account-a', '/api/usage/summary?days=7', response), true);
    assert.equal(await first.put('server-a|account-a', '/api/usage/summary?days=7', response), false);
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);

    const restarted = new CloudDashboardCache(file);
    assert.deepEqual(await restarted.get('server-a|account-a', '/api/usage/summary?days=7'), response);
    assert.equal(await restarted.get('server-a|account-b', '/api/usage/summary?days=7'), null);
    assert.equal(await restarted.get('server-b|account-a', '/api/usage/summary?days=7'), null);
    await restarted.clear();
    assert.equal(await new CloudDashboardCache(file).get('server-a|account-a', '/api/usage/summary?days=7'), null);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
