import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPkce, checkedLoginUrl, normalizeDesktopServer } from '../app/auth.js';

test('desktop authorization uses S256 and accepts only the chosen server and provider', () => {
  const first = createPkce(); const second = createPkce();
  assert.match(first.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first.verifier, second.verifier);
  assert.equal(first.challenge, createHash('sha256').update(first.verifier).digest('base64url'));
  assert.equal(normalizeDesktopServer('https://tokenflow.renaissancemind.ai/'), 'https://tokenflow.renaissancemind.ai');
  assert.equal(normalizeDesktopServer('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
  for (const url of ['http://example.com', 'https://secret@example.com', 'https://example.com/path', 'https://example.com/?key=secret']) assert.throws(() => normalizeDesktopServer(url));
  assert.equal(checkedLoginUrl('https://example.com/auth/login/google?return_to=x', 'https://example.com', 'google'), 'https://example.com/auth/login/google?return_to=x');
  assert.throws(() => checkedLoginUrl('https://other.example/auth/login/google', 'https://example.com', 'google'));
  assert.throws(() => checkedLoginUrl('https://example.com/auth/login/github', 'https://example.com', 'google'));
});
