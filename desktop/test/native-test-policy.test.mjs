import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const policy = fileURLToPath(new URL('../scripts/native-test-policy.mjs', import.meta.url));
const env = { ...process.env };
for (const key of ['GITHUB_ACTIONS', 'TOKENFLOW_TEST_DISPLAY_ISOLATED', 'TOKENFLOW_ALLOW_FOREGROUND_TESTS']) delete env[key];

test('native UI tests refuse to start on the user desktop by default', () => {
  const result = spawnSync(process.execPath, [policy], { env, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /can activate windows and take desktop focus/);
});

test('native UI tests require an isolated environment or explicit foreground approval', () => {
  for (const allowed of [{ GITHUB_ACTIONS: 'true' }, { TOKENFLOW_TEST_DISPLAY_ISOLATED: '1' }, { TOKENFLOW_ALLOW_FOREGROUND_TESTS: '1' }]) {
    const result = spawnSync(process.execPath, [policy], { env: { ...env, ...allowed }, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});
