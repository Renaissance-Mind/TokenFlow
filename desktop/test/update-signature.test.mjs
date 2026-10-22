import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportsMacUpdates } from '../app/update-signature.js';

const signed = 'Identifier=ai.renaissancemind.tokenflow\nAuthority=Developer ID Application: Cao Pu (25SQGCZHYG)\nTeamIdentifier=25SQGCZHYG\n';
test('automatic updates require the stable bundle and Developer ID publisher', () => {
  assert.equal(supportsMacUpdates(signed), true);
  assert.equal(supportsMacUpdates(signed.replace('25SQGCZHYG\n', 'OTHERTEAM\n')), false);
  assert.equal(supportsMacUpdates(signed.replace('ai.renaissancemind.tokenflow', 'Electron')), false);
  assert.equal(supportsMacUpdates(signed.replace('Developer ID Application:', 'Apple Development:')), false);
  assert.equal(supportsMacUpdates('Identifier=Electron\nSignature=adhoc\nTeamIdentifier=not set\n'), false);
  assert.equal(supportsMacUpdates(''), false);
});
