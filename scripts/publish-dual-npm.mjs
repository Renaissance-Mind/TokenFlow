#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const packageNames = ["tokenflow", "@renaissancemind/tokenflow"];
const dryRun = process.argv.includes("--dry-run");

const originalText = await readFile(packageJsonUrl, "utf8");
const originalPackage = JSON.parse(originalText);

if (originalPackage.name !== "tokenflow") {
  throw new Error(`Expected package.json name to be tokenflow, found ${originalPackage.name}`);
}

let exitCode = 0;

try {
  for (const packageName of packageNames) {
    const nextPackage = { ...originalPackage, name: packageName };
    await writeFile(packageJsonUrl, `${JSON.stringify(nextPackage, null, 2)}\n`);

    process.stdout.write(
      `\nPublishing ${packageName}@${originalPackage.version}${dryRun ? " (dry run)" : ""}\n`,
    );
    const result = spawnSync(
      "npm",
      ["publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      exitCode = result.status || 1;
      break;
    }
  }
} finally {
  await writeFile(packageJsonUrl, originalText);
}

process.exit(exitCode);
