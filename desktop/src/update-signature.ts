import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const desktopReleasesUrl = "https://github.com/Renaissance-Mind/TokenFlow/releases?q=desktop-v";

export function supportsMacUpdates(signature: string): boolean {
  return /^Identifier=ai\.renaissancemind\.tokenflow$/m.test(signature)
    && /^Authority=Developer ID Application: /m.test(signature)
    && /^TeamIdentifier=25SQGCZHYG$/m.test(signature);
}

export async function hasMacUpdateSignature(executable: string): Promise<boolean> {
  const { stderr } = await execute("/usr/bin/codesign", ["-dvv", executable]).catch((error: NodeJS.ErrnoException) => {
    // codesign exits 1 for unsigned code. Tool/OS errors still surface.
    if (Number(error.code) === 1) return { stderr: "" };
    throw error;
  });
  return supportsMacUpdates(stderr);
}
