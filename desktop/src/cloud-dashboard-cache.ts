import fs from "node:fs/promises";
import path from "node:path";

interface Entry { updatedAt: string; value: unknown }
interface Snapshot { version: 1; scope: string; entries: Record<string, Entry> }

// The App keeps only successful Dashboard API responses. The scope binds them
// to the server and signed-in account, so another login cannot read them.
export class CloudDashboardCache {
  private snapshot: Snapshot | null | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  private async read(): Promise<Snapshot | null> {
    if (this.snapshot !== undefined) return this.snapshot;
    const raw = await fs.readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!raw) return this.snapshot = null;
    let value: Snapshot;
    try { value = JSON.parse(raw) as Snapshot; }
    catch (error) { if (!(error instanceof SyntaxError)) throw error; return this.snapshot = null; }
    return this.snapshot = value?.version === 1 && typeof value.scope === "string" && value.entries && typeof value.entries === "object" ? value : null;
  }

  async get(scope: string, endpoint: string): Promise<unknown | null> {
    const snapshot = await this.read();
    return snapshot?.scope === scope ? snapshot.entries[endpoint]?.value ?? null : null;
  }

  async put(scope: string, endpoint: string, value: unknown): Promise<boolean> {
    const task = this.pending.then(async () => {
      const previous = await this.read();
      const snapshot: Snapshot = previous?.scope === scope ? previous : { version: 1, scope, entries: {} };
      if (JSON.stringify(snapshot.entries[endpoint]?.value) === JSON.stringify(value)) return false;
      snapshot.entries[endpoint] = { updatedAt: new Date().toISOString(), value };
      const ordered = Object.entries(snapshot.entries).sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
      snapshot.entries = Object.fromEntries(ordered.slice(0, 128));
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
      await fs.rename(temporary, this.file);
      this.snapshot = snapshot;
      return true;
    });
    this.pending = task.then(() => undefined, () => undefined);
    return task;
  }

  async clear(): Promise<void> {
    await this.pending;
    this.snapshot = null;
    await fs.rm(this.file, { force: true });
  }
}
