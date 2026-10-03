import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function sourceRoots(
  name: string,
  home: string,
  defaults: string[],
): string[] {
  const configured = process.env[name]?.trim();
  return [
    ...new Set(
      configured
        ? configured
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
        : defaults.map((item) => path.join(home, item)),
    ),
  ];
}

export async function storeFiles(
  root: string,
  accept: (file: string) => boolean,
): Promise<string[]> {
  const entries = await fs
    .readdir(root, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return [];
      throw error;
    });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await storeFiles(file, accept)));
    else if (entry.isFile() && accept(file)) files.push(file);
  }
  return files;
}

export async function sqliteRows<T extends object>(
  file: string,
  query: string,
): Promise<T[]> {
  const { stdout } = await execute(
    "sqlite3",
    [
      "-readonly",
      "-json",
      "-cmd",
      ".timeout 5000",
      file,
      `PRAGMA query_only=ON; ${query}`,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout.trim() ? (JSON.parse(stdout) as T[]) : [];
}

export async function archivedSqliteSnapshot(
  file: string,
): Promise<{ path: string; close: () => Promise<void> }> {
  const handle = await fs.open(file, "r");
  const header = Buffer.alloc(20);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }
  const exists = async (name: string) =>
    fs
      .stat(name)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
  if (
    header[18] !== 2 ||
    (await exists(`${file}-wal`)) ||
    (await exists(`${file}-journal`))
  )
    return { path: file, close: async () => {} };
  // Serialized WAL-mode databases without sidecars are immutable archives.
  const before = await fs.stat(file);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokenflow-sqlite-"));
  const snapshot = path.join(dir, "archive.db");
  try {
    await fs.copyFile(file, snapshot);
    const after = await fs.stat(file);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      (await exists(`${file}-wal`))
    )
      throw new Error(`SQLite archive changed during snapshot: ${file}`);
  } catch (error) {
    await fs.rm(dir, { recursive: true, force: true });
    throw error;
  }
  return {
    path: `${pathToFileURL(snapshot).href}?immutable=1`,
    close: () => fs.rm(dir, { recursive: true, force: true }),
  };
}

export async function tableColumns(
  file: string,
  table: string,
): Promise<Set<string>> {
  if (!/^[a-z_][a-z0-9_]*$/.test(table))
    throw new Error("Invalid SQLite table name");
  const rows = await sqliteRows<{ name: string }>(
    file,
    `PRAGMA table_info(${table});`,
  );
  return new Set(rows.map((row) => row.name));
}

export async function readStoreLines(
  file: string,
  consume: (line: string) => void,
): Promise<void> {
  const lines = createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of lines) if (line.trim()) consume(line);
}

export async function initialSessionRecord(
  file: string,
): Promise<Record<string, unknown> | null> {
  const stream = createReadStream(file);
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) {
      if (++count > 256) return null;
      if (!line.includes("session_meta")) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (record.type === "session_meta") return record;
    }
    return null;
  } finally {
    lines.close();
    stream.destroy();
  }
}

export async function optionalJson(
  file: string,
): Promise<Record<string, unknown> | null> {
  const stat = await fs.stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!stat?.isFile()) return null;
  const raw = await fs
    .readFile(file, "utf8")
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}
