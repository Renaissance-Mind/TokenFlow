import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compareVersions} from '../app/cli-update.js';

test('CLI and App update versions are compared numerically and malformed metadata is rejected',()=>{
  assert.equal(compareVersions('0.2.100','0.2.82'),1);
  assert.equal(compareVersions('0.1.20','0.1.19'),1);
  assert.equal(compareVersions('0.2.82','0.2.82'),0);
  assert.equal(compareVersions('0.2.81','0.2.82'),-1);
  assert.throws(()=>compareVersions('not-a-version','0.2.82'),/Invalid CLI version/);
});
