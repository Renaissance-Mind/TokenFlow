export interface ResolverProfile {
  modelId: string;
  pricingSource?: "litellm" | "models.dev" | "curated" | "supplemental";
  vendorModel?: string;
  exactOnly?: boolean;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
}
interface Index<T> { primary: T[]; secondary: T[]; supplemental: T[]; primaryNames: Map<string, T[]>; vendors: Map<string, T[]>; secondaryNames: Map<string, T[]>; supplementalNames: Map<string, T[]> }
const indexes = new WeakMap<object, Index<ResolverProfile>>();
const identity = (name: string) => name.replace(/[.@]/g, "-");
const lastSegment = (name: string) => name.slice(name.lastIndexOf("/") + 1);
const free = (row: ResolverProfile) => Number(row.inputUsdPerMillion) === 0 && Number(row.outputUsdPerMillion) === 0;
function groups<T extends ResolverProfile>(rows: T[], key: (row: T) => string | undefined): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) {
    const name = key(row); if (name === undefined) continue;
    const group = result.get(name) || []; group.push(row); result.set(name, group);
  }
  return result;
}
function catalogIndex<T extends ResolverProfile>(rows: readonly T[]): Index<T> {
  const previous = indexes.get(rows) as Index<T> | undefined;
  if (previous) return previous;
  const layers = [new Map<string, T>(), new Map<string, T>(), new Map<string, T>()];
  for (const row of rows) layers[row.pricingSource === "models.dev" ? 1 : row.pricingSource === "supplemental" ? 2 : 0].set(row.modelId, row);
  const [primary, secondary, supplemental] = layers.map(layer => [...layer.values()]);
  const result = { primary, secondary, supplemental, primaryNames: groups(primary, row => identity(row.modelId)),
    vendors: groups(primary, row => row.vendorModel ? identity(row.vendorModel) : undefined),
    secondaryNames: groups(secondary, row => identity(row.modelId)), supplementalNames: groups(supplemental, row => identity(row.modelId)) };
  indexes.set(rows, result); return result;
}
function first<T extends ResolverProfile>(rows: T[] | undefined, name: string, accept: (row: T) => boolean = () => true): T | null {
  const matching = (rows || []).filter(accept);
  return matching.find(row => row.modelId === name) || matching.sort((a, b) => a.modelId.localeCompare(b.modelId))[0] || null;
}
function authoritative<T extends ResolverProfile>(index: Index<T>, name: string, hosted: boolean, accept: (row: T) => boolean = () => true): T | null {
  const rows = index.primaryNames.get(identity(name));
  const direct = first(rows, name, row => accept(row) && (row.vendorModel !== undefined || row.modelId.includes("/") || row.pricingSource === undefined));
  if (direct) return direct;
  const vendors = (index.vendors.get(identity(name)) || []).filter(accept);
  const rates = (row: T) => JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key]) => /UsdPerMillion|Threshold|Multiplier/.test(key))));
  if (vendors.length && vendors.every(row => rates(row) === rates(vendors[0]))) return first(vendors, name);
  return hosted ? first(rows, name, accept) : null;
}
function suffixes(name: string): string[] {
  const result: string[] = [];
  for (let slash = name.indexOf("/"); slash >= 0; slash = name.indexOf("/", slash + 1)) result.push(name.slice(slash + 1));
  return result;
}
function containsIdentity(value: string, key: string): boolean {
  for (let offset = value.indexOf(key); offset >= 0; offset = value.indexOf(key, offset + 1)) {
    const before = value[offset - 1], rest = value.slice(offset + key.length);
    if (before && /[a-z0-9]/i.test(before) || rest && /[a-z0-9]/i.test(rest[0])) continue;
    if (/\d$/.test(key) && /^[-.]\d/.test(rest) && !/^[-.]\d{8}(?:$|[^a-z0-9])/i.test(rest)) continue;
    return true;
  }
  return false;
}
function servicePlans(name: string): string[] { return name.match(/(?:^|[-/:@])(?:ultrafast|fast|flex|spot|batch|free)(?=$|[-/:@])/g)?.map(value => value.replace(/^[-/:@]/, "")) || []; }
function fuzzy<T extends ResolverProfile>(rows: T[], name: string): T | null {
  if (!/[-.\d]/.test(lastSegment(name))) return null;
  const normalized = identity(name), segment = lastSegment(normalized), plans = servicePlans(normalized);
  const matches = rows.filter(row => !row.exactOnly && !free(row) && servicePlans(identity(row.modelId)).every(plan => plans.includes(plan))
    && (containsIdentity(normalized, identity(row.modelId)) || containsIdentity(identity(row.modelId), normalized)));
  const exactSegment = matches.some(row => lastSegment(identity(row.modelId)) === segment);
  return matches.filter(row => !exactSegment || lastSegment(identity(row.modelId)).length <= segment.length)
    .sort((a, b) => b.modelId.length - a.modelId.length || a.modelId.localeCompare(b.modelId))[0] || null;
}
export function resolveCatalogPricing<T extends ResolverProfile>(model: string | readonly string[], rows: readonly T[], aliases: ReadonlyArray<readonly [string, string]>): T | null {
  const models = (typeof model === "string" ? [model] : model).filter(model => !model.startsWith("unpriced-"));
  if (!models.length) return null;
  const index = catalogIndex(rows);
  const names = models.flatMap(model => {
    const raw = model.trim().replace(/\[1m\]$/i, "").replace(/@(?=gpt-)/g, "/");
    const segment = lastSegment(raw);
    const alias = aliases.find(([key]) => identity(key) === identity(segment))?.[1];
    return [...new Set([raw, ...(alias ? [raw.slice(0, raw.length - segment.length) + alias] : []), raw.toLowerCase(), ...(raw.endsWith("-build") ? [raw.slice(0, -6)] : [])])];
  });
  for (const name of names) { const found = authoritative(index, name, true); if (found) return found; }
  for (const model of models) {
    const raw = model.trim().replace(/\[1m\]$/i, "");
    if (!index.secondaryNames.has(identity(raw))) {
      const retired = first(index.supplementalNames.get(identity(raw)), raw, row => row.exactOnly === true);
      if (retired) return retired;
    }
  }
  for (const name of names) {
    for (const suffix of suffixes(name)) { const found = authoritative(index, suffix, false, row => !free(row)); if (found) return found; }
    const found = first(index.secondaryNames.get(identity(name)), name); if (found) return found;
  }
  for (const name of names) for (const candidate of suffixes(name)) {
    if (authoritative(index, candidate, false)) break;
    const found = first(index.secondaryNames.get(identity(candidate)), candidate); if (found) return found;
  }
  for (const name of names) for (const suffix of suffixes(name)) {
    const found = authoritative(index, suffix, false, row => row.vendorModel !== undefined && free(row)); if (found) return found;
  }
  for (const name of names) {
    const protectedIdentity = [name, ...suffixes(name)].some(candidate => index.secondaryNames.get(identity(candidate))?.some(row => row.exactOnly));
    if (protectedIdentity) continue;
    if (name.endsWith("-build")) continue;
    const result = fuzzy(index.primary, name) || fuzzy(index.secondary, name) || fuzzy(index.supplemental, name);
    if (result) return result;
    const supplemental = first(index.supplementalNames.get(identity(name)), name); if (supplemental) return supplemental;
  }
  return null;
}
