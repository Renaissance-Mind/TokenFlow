import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { codexRolloutStat, isCodexRollout } from "./sources/codex-reader.js";

export interface ScanProgress {
  stage: "discovery" | "reading" | "processing";
  discoveredFiles: number;
  processedFiles: number;
  totalFiles: number | null;
  readBytes: number;
  percent: number;
}

export interface CollectionPlan<T> {
  files: string[];
  collect(): Promise<T>;
}
const context = new AsyncLocalStorage<ScanTracker>();

export class ScanTracker {
  private discovered = new Set<string>();
  private files = new Map<
    string,
    { size: number; bytes: number; complete: boolean }
  >();
  private stage: ScanProgress["stage"] = "discovery";
  private processed = 0;
  private read = 0;
  private partial = 0;
  private lastEmission = 0;
  constructor(
    private onProgress: (progress: ScanProgress) => void,
    private interval = 100,
  ) {
    this.emit(true);
  }
  discover(file: string): void {
    this.discovered.add(file);
    this.emit();
  }
  async begin(files: string[]): Promise<void> {
    for (const file of new Set(files)) {
      this.discovered.add(file);
      const stat = await fs.stat(file).catch(error => {
        if (error.code === "ENOENT" && isCodexRollout(file)) return codexRolloutStat(file);
        throw error;
      });
      this.files.set(file, { size: stat.size, bytes: 0, complete: false });
    }
    this.stage = "reading";
    this.emit(true);
  }
  bytes(file: string, consumed: number): void {
    const item = this.files.get(file);
    if (!item || item.complete || !item.size) return;
    const next = Math.min(item.size, Math.max(item.bytes, consumed));
    this.read += next - item.bytes;
    this.partial += (next - item.bytes) / item.size;
    item.bytes = next;
    this.emit();
  }
  complete(file: string): void {
    const item = this.files.get(file);
    if (!item || item.complete) return;
    this.partial -= item.size ? item.bytes / item.size : 0;
    item.complete = true;
    this.processed++;
    this.emit(this.processed === this.files.size);
  }
  processing(): void {
    this.stage = "processing";
    this.emit(true);
  }
  private emit(force = false): void {
    if (!force && Date.now() - this.lastEmission < this.interval) return;
    this.lastEmission = Date.now();
    this.onProgress({
      stage: this.stage,
      discoveredFiles: this.discovered.size,
      processedFiles: this.processed,
      totalFiles: this.stage === "discovery" ? null : this.files.size,
      readBytes: this.read,
      percent:
        this.stage === "discovery"
          ? 0
          : this.files.size
            ? Math.max(
                0,
                Math.min(
                  this.processed === this.files.size ? 100 : 99.9,
                  ((this.processed + this.partial) / this.files.size) * 100,
                ),
              )
            : 100,
    });
  }
}

export function withScanTracker<T>(
  tracker: ScanTracker | undefined,
  action: () => Promise<T>,
): Promise<T> {
  return tracker ? context.run(tracker, action) : action();
}
export function discoveredFile(file: string): void {
  context.getStore()?.discover(file);
}
export function scannedBytes(file: string, consumed: number): void {
  context.getStore()?.bytes(file, consumed);
}
export async function scanFile<T>(
  file: string,
  action: () => Promise<T>,
): Promise<T> {
  const result = await action();
  context.getStore()?.complete(file);
  return result;
}
