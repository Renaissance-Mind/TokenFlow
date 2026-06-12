export function resolveUpdatePackageSpec(
  explicitSource?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  const source =
    explicitSource?.trim() || env.TOKENFLOW_UPDATE_SOURCE?.trim() || env.TOKENUSAGE_UPDATE_SOURCE?.trim();
  return source || "@renaissancemind/tokenflow@latest";
}
