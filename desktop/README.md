# TokenFlow Desktop

TokenFlow Desktop combines the hosted dashboard, local collector, and a menu bar or system tray in one application. The installer includes Electron, the collector, and SQLite; users do not need Node.js, npm, or an external SQLite installation.

Install the DMG on macOS or run the EXE installer on Windows. On first launch, choose a device name and sign in with GitHub or Google in your default browser. Approve the desktop connection once to authorize both the dashboard and this computer’s collector.

The menu bar on macOS can show today’s estimated cost, today’s tokens, or only the icon. Windows displays the same information in its tray tooltip and popup. The popup and local window also show the last seven days, source availability, last sync time, and errors. Local statistics remain available offline. The full dashboard uses the existing cloud service and includes all connected devices.

Automatic sync runs every ten minutes while the app is running. Closing a window keeps the app in the tray. Preferences control login startup and pausing automatic sync; manual sync remains available while paused. On macOS, a bundled collector also refreshes the existing launchd task, which continues syncing after the desktop app quits. Its scheduled sync yields while the app owns collection. Windows collection runs in the resident app; choosing Quit stops it until the next launch.

Desktop authorization, sync, and pricing requests follow the system network proxy configuration. The macOS scheduled collector uses the same Chromium network stack without opening a window.

Existing `~/.tokenflow/config.json` and legacy `~/.tokenusage/config.json` are reused. An existing device can be linked to its dashboard account without creating a duplicate device. Changing the account clears the upload ledger so that the new account receives a full snapshot. Desktop dashboard credentials use the operating system credential store, with a recovery journal for interrupted sign-ins. The collector’s device token remains in its existing private config for CLI compatibility. Signing out disconnects the current collector device and revokes desktop authorization while retaining historical usage. Prompts, responses, session IDs, and source paths are not uploaded.

## Development

Use Node.js 24 or newer to build the desktop app. The standalone CLI continues to support Node.js 20 or newer.

```sh
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm start --prefix desktop
```

Some npm configurations skip dependency installation scripts. The explicit Electron install step downloads its platform runtime in that case.

```sh
npm test
npm run typecheck
npm run build --prefix desktop
npm test --prefix desktop
npm run smoke --prefix desktop
```

The desktop smoke test launches a real Electron process with isolated data directories. It checks the bundled collector, offline summary, preferences, language switching, tray residency when closing a window, and the update action, including recoverable network errors. SQLite tests read actual databases, including active WAL files and archive copies. The Windows installer check installs the actual EXE into a temporary directory, verifies its bundled runtime, launches the installed application, and uninstalls it afterwards.

To verify desktop login against the real Worker/D1 backend, check out the matching TokenFlow_Server desktop branch and run:

```sh
cd ../TokenFlow_Server
npm ci
npm run test:desktop-auth
cd ../TokenFlow/desktop
TOKENFLOW_AUTH_TEST_SERVER=/absolute/path/TokenFlow_Server/scripts/desktop-test-server.mjs node scripts/auth-smoke.mjs
```

These checks use an isolated signed-in test account and verify authorization, concurrent redemption, device reuse, sessions, actual collector sync, and revocation. External GitHub and Google identity verification requires a real browser sign-in and is not simulated.

## Build and distribution

```sh
npm run dist:mac --prefix desktop -- --publish never
npm run dist:win --prefix desktop -- --publish never
node desktop/scripts/packaged-smoke.mjs
```

Mac builds produce Apple Silicon and Intel DMGs plus ZIPs. Windows builds produce an x64 NSIS installer. The GitHub Actions desktop workflow builds and checks each platform on its native runner and retains installer artifacts.

Set `CSC_NAME` or the electron-builder certificate variables to sign release builds. The local developer certificate name omits the `Developer ID Application:` prefix. Public Mac releases need notarization using the distributor’s Apple credentials; enable `mac.notarize` when those credentials are configured. Windows release builds can use an appropriate code-signing certificate. CI builds are unsigned unless signing credentials are configured.

Desktop updates use published GitHub releases tagged `desktop-vX.Y.Z`. Upload the installers and generated `latest.yml`, `latest-mac.yml`, and blockmaps to that release. The app selects desktop releases separately from CLI npm releases and offers download and install actions in Preferences. No update is published by a local build.

The corresponding server migration `0009_desktop_auth.sql` and desktop authorization endpoints must be deployed before the hosted service can authorize these apps. Deploy the migration before the Worker. Existing OAuth client settings and callback URLs continue to apply.

`TOKENFLOW_DESKTOP_DATA` and `TOKENFLOW_SCAN_HOME` provide isolated directories for native acceptance tests. An isolated desktop data directory disables operating-system startup and scheduler changes. `TOKENFLOW_EXECUTABLE` selects a packaged executable for smoke tests.
