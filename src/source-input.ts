import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import { isUtf8 } from "node:buffer";

export interface SourceIssue { file: string; category: string; count: number }
const context = new AsyncLocalStorage<Map<string, SourceIssue>>();
const physicalPaths = new Map<string, Buffer>();
export function physicalSourcePath(file: string): string | Buffer {
  if (!physicalPaths.size) return file;
  let prefix = file;
  while (prefix !== path.dirname(prefix)) {
    const physical = physicalPaths.get(prefix);
    if (physical) return prefix === file ? physical : Buffer.concat([physical, Buffer.from(path.sep + path.relative(prefix, file))]);
    prefix = path.dirname(prefix);
  }
  return file;
}
export function sourceName(bytes: Buffer): string {
  let name = "";
  for (let index = 0; index < bytes.length;) {
    const byte = bytes[index];
    const width = byte < 128 ? 1 : byte >= 194 && byte <= 223 ? 2 : byte >= 224 && byte <= 239 ? 3 : byte >= 240 && byte <= 244 ? 4 : 0;
    const part = bytes.subarray(index, index + width);
    if (!width || part.length !== width || !isUtf8(part)) { name += `\uE000b${byte.toString(16).padStart(2, "0")};`; index++; }
    else { const text = part.toString("utf8"); name += text === "\uE000" ? "\uE000u;" : text; index += width; }
  }
  return name;
}
export function withSourceDiagnostics<T>(action: () => Promise<T>): Promise<T> { return context.run(new Map(), action); }
export function sourceIssues(): SourceIssue[] { return [...(context.getStore()?.values() || [])]; }
export function hasSourceDiagnostics(): boolean { return context.getStore() !== undefined; }
export async function readSourceUtf8(file: string): Promise<string> {
  const bytes = await fs.readFile(physicalSourcePath(file));
  if (!isUtf8(bytes)) throw new SyntaxError("Invalid UTF-8 source document");
  return bytes.toString("utf8");
}
export function sourceIssueMarker(): Map<string, number> { return new Map(sourceIssues().map(issue => [JSON.stringify([issue.file, issue.category]), issue.count])); }
export function sourceIssuesSince(marker: Map<string, number>): SourceIssue[] {
  return sourceIssues().map(issue => ({ ...issue, count: issue.count - (marker.get(JSON.stringify([issue.file, issue.category])) || 0) })).filter(issue => issue.count > 0);
}
export function restoreSourceIssues(issues: SourceIssue[] = []): void { for (const issue of issues) reportSourceIssue(issue.file, issue.category, issue.count); }
export function reportSourceIssue(file: string, category: string, count = 1): void {
  if (!count) return;
  const issues = context.getStore();
  const key = JSON.stringify([file, category]);
  const previous = issues?.get(key);
  issues?.set(key, { file, category, count: (previous?.count || 0) + count });
}
export function sourceInputCategory(error: unknown): string | null {
  if (error instanceof SyntaxError) return "invalid JSON";
  if (!(error instanceof Error)) return null;
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "ERR_ENCODING_INVALID_ENCODED_DATA" || /^invalid zstd data/i.test(error.message)) return "invalid source encoding";
  if ((error as NodeJS.ErrnoException).syscall?.startsWith("spawn")) return null;
  if (["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EIO", "ELOOP"].includes(code || "")) return `unreadable file (${code})`;
  if (/file is not a database|database disk image is malformed|database is locked|unable to open database|disk I\/O error|no such table|no such column|SQLITE_(?:CORRUPT|NOTADB|BUSY|LOCKED)/i.test(error.message)) return "unreadable SQLite data";
  if (/^Antigravity metadata has no chat model/.test(error.message)) return "invalid source encoding or schema";
  if (/^(?:Invalid|Unsupported|Truncated|Conflicting|Duplicate|dsh .* (?:missing|mismatch)|Antigravity .* exceeds)/.test(error.message)
    && /dsh|Antigravity|Zstandard|zstd/i.test(error.message)) return "invalid source encoding or schema";
  return null;
}
export async function readSourceInput<T>(file: string, action: () => Promise<T>, fallback: T): Promise<T> {
  try { return await action(); }
  catch (error) {
    const category = sourceInputCategory(error);
    if (!category) throw error;
    reportSourceIssue(file, category); return fallback;
  }
}
export function expandSourcePath(value: string, root: string): string {
  return value === "~" ? root : value.startsWith("~/") ? path.join(root, value.slice(2)) : value;
}
export async function discoverSourceFiles(root: string, accept: (file: string) => boolean, maxDepth = Infinity): Promise<string[]> {
  const seenDirectories = new Set<string>(), seenFiles = new Set<string>(), files: string[] = [];
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const nativeDirectory = physicalSourcePath(directory);
    const physical = await fs.realpath(nativeDirectory, { encoding: "buffer" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
      throw error;
    });
    if (!physical || seenDirectories.has(physical.toString("hex"))) return;
    seenDirectories.add(physical.toString("hex"));
    const entries = await fs.readdir(nativeDirectory, { withFileTypes: true, encoding: "buffer" });
    for (const entry of entries.sort((a, b) => Buffer.compare(a.name, b.name))) {
      const file = path.join(directory, sourceName(entry.name));
      const nativeFile = Buffer.concat([Buffer.isBuffer(nativeDirectory) ? nativeDirectory : Buffer.from(nativeDirectory), Buffer.from(path.sep), entry.name]);
      if (!nativeFile.equals(Buffer.from(file))) physicalPaths.set(file, nativeFile);
      const stat = entry.isSymbolicLink() ? await readSourceInput(file, () => fs.stat(nativeFile), null) : entry;
      if (stat?.isDirectory()) await readSourceInput(file, () => visit(file, depth + 1), undefined);
      else if (stat?.isFile() && accept(file)) {
        const physicalFile = (await fs.realpath(nativeFile, { encoding: "buffer" })).toString("hex");
        if (!seenFiles.has(physicalFile)) { seenFiles.add(physicalFile); files.push(file); }
      }
    }
  }
  await readSourceInput(root, () => visit(root, 0), undefined);
  return files;
}
