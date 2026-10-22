// Run before electron-builder creates ZIPs and update manifests.
const path = require('node:path');
const { execFileSync } = require('node:child_process');

module.exports = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== 'darwin') return;
  // CI without signing credentials builds only unpacked test apps. Release
  // targets keep forceCodeSigning enabled and must pass both checks below.
  if (packager.platformSpecificBuildOptions.forceCodeSigning === false && packager.platformSpecificBuildOptions.identity === null) return;
  const application = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
  // Keep the publisher and bundle requirement stable across releases.
  execFileSync('/usr/bin/codesign', ['--verify', '-R', '=identifier "ai.renaissancemind.tokenflow" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "25SQGCZHYG"', application], { stdio: 'inherit' });
};
