import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { readEmbeddedSqlite } from '../app/sqlite.js';

test('bundled SQLite reads live WAL databases and immutable archives without external sqlite3', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'tokenflow-sqlite-test-'));
  const file = path.join(dir,'store.db');
  const writer = new DatabaseSync(file);
  try {
    writer.exec('PRAGMA journal_mode=WAL; CREATE TABLE usage(tokens INTEGER); INSERT INTO usage VALUES(1234);');
    assert.equal((await readEmbeddedSqlite(file,'SELECT tokens FROM usage'))[0].tokens,1234);
    await assert.rejects(readEmbeddedSqlite(file,'DELETE FROM usage'));
    writer.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    await fs.copyFile(file,path.join(dir,'archive.db'));
    assert.equal((await readEmbeddedSqlite(pathToFileURL(path.join(dir,'archive.db')).href+'?immutable=1','SELECT tokens FROM usage'))[0].tokens,1234);
  } finally { writer.close(); await fs.rm(dir,{recursive:true,force:true}); }
});
