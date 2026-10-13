import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { setSqliteReader } from './sources/store-io.js';
import { main } from './cli.js';

setSqliteReader(async (file, query) => {
  const db = new DatabaseSync(file.startsWith('file:') ? fileURLToPath(new URL(file)) : file, { readOnly:true,timeout:5000 });
  try { db.exec('PRAGMA query_only=ON'); return db.prepare(query).all(); }
  finally { db.close(); }
});
await main(process.argv.slice(2)).catch((error) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
});
