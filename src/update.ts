export function resolveUpdatePackageSpec(
  explicitSource?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const source = explicitSource?.trim() || env.TOKENUSAGE_UPDATE_SOURCE?.trim();
  return source || "@renaissancemind/tokenusage@latest";
}
