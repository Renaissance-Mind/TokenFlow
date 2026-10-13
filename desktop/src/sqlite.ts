import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export async function readEmbeddedSqlite(file: string, query: string): Promise<object[]> {
  const filename = file.startsWith("file:") ? fileURLToPath(new URL(file)) : file;
  const db = new DatabaseSync(filename, { readOnly: true, timeout: 5000 });
  try { db.exec("PRAGMA query_only=ON;"); return db.prepare(query).all(); }
  finally { db.close(); }
}
