# TokenFlow Desktop

TokenFlow Desktop uses Tauri 2 and the system WebView to combine the dashboard, a bundled usage collector, and the macOS menu bar or Windows tray. Users do not need Node.js, npm, or SQLite. Windows installers install WebView2 if it is missing; that step needs an internet connection.

Install the DMG on macOS 13.5 or newer or run the EXE on Windows. On first launch, choose a device name and sign in with GitHub or Google in your default browser. Approve the connection to authorize the dashboard and this computer’s collector. Existing `~/.tokenflow/config.json` and legacy `~/.tokenusage/config.json` are reused. An existing device can be linked to its dashboard account without creating another device.

The macOS menu bar shows today’s estimated cost, tokens, or only the icon. Windows shows the same information in the tray tooltip and popup. The popup and local window include seven days of usage, source availability, sync status, and errors. Local statistics remain available offline. The full dashboard shows all connected devices through the cloud service.

Automatic sync runs every ten minutes while the app is running. Closing a window keeps the app in the tray. Preferences control startup and pausing automatic sync; manual sync remains available while paused. On macOS, the app installs a bundled CLI launcher under the collector’s `bin` directory and updates its launchd sync task. Scheduled sync uses native networking and yields while the app owns collection. On Windows, collection runs in the resident app and stops when the app quits. Authorization, sync, and pricing requests use the system proxy configuration.

Dashboard authorization is stored in macOS Keychain or Windows Credential Manager. A recovery journal covers interrupted sign-ins. The collector’s device token stays in its private config for CLI compatibility. Signing out revokes desktop authorization and disconnects the current collector while retaining historical usage. Only usage counts are uploaded; prompts, responses, session IDs, and source paths stay local.

The JavaScript parsers run in a standalone Node executable alongside the Rust shell. This preserves the collector’s supported sources and embedded SQLite. It contributes most of the remaining application size; Tauri does not require a bundled browser engine.

## Development

Install a current Rust toolchain, platform build prerequisites, and Node.js 24 or newer. The builder downloads checksum-verified official Node 26.5 binaries for the standalone collector. The standalone npm CLI still supports Node.js 20 or newer.

```sh
npm ci
npm ci --prefix desktop
npm start --prefix desktop
```

```sh
npm test
npm run typecheck
npm run pack --prefix desktop
npm run typecheck --prefix desktop
npm test --prefix desktop
npm run smoke --prefix desktop
```

The smoke test opens a real native WebView with isolated source and data directories. It checks the bundled collector, local summary, preferences, language, tray popup, and window residency. SQLite tests read actual WAL databases and immutable archives. Packaged checks copy the macOS app outside the repository. Windows checks install the actual NSIS EXE, verify its sidecar, test startup registration, and uninstall afterwards.

Desktop authorization acceptance uses the real Worker/D1 service with an isolated signed-in test account. External GitHub or Google identity verification requires a real browser sign-in and is not simulated.

```sh
TOKENFLOW_AUTH_TEST_SERVER=/absolute/path/TokenFlow_Server/scripts/desktop-test-server.mjs node desktop/scripts/auth-smoke.mjs
```

## Distribution

```sh
npm run dist:mac --prefix desktop
npm run dist:win --prefix desktop
node desktop/scripts/packaged-smoke.mjs
```

Outputs are under `desktop/src-tauri/target/release/bundle`. macOS builds the host architecture by default. To build Intel on Apple Silicon, install the Rust `x86_64-apple-darwin` target, set `TOKENFLOW_TARGET=x86_64-apple-darwin`, and pass `--target x86_64-apple-darwin` to the build. Windows uses an x64 NSIS installer. CI builds and checks both platforms on native runners; its installers are unsigned and omit updater artifacts.

Set `APPLE_SIGNING_IDENTITY` to a full Developer ID Application identity for macOS signing. Public distribution also needs notarization with the distributor’s Apple credentials. Windows signing uses Tauri’s Windows signing configuration and the distributor’s certificate.

Updates use GitHub releases tagged `desktop-vX.Y.Z`, containing a Tauri `latest.json` manifest and signed updater artifacts. The public verification key is committed; keep its private key outside the repository. Set `TAURI_SIGNING_PRIVATE_KEY` to that key’s path and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` for release builds. Upload the generated macOS `.app.tar.gz` and Windows installer with their `.sig` files; include their URLs and signatures in the manifest. Preferences offer check, download, and install actions. Local builds do not publish updates. Builds without the release key can pass `--config '{"bundle":{"createUpdaterArtifacts":false}}'`.

The hosted server needs migration `0009_desktop_auth.sql` and its desktop authorization endpoints. Existing OAuth client settings and callback URLs continue to apply.

`TOKENFLOW_DESKTOP_DATA`, `TOKENFLOW_HOME`, and `TOKENFLOW_SCAN_HOME` isolate native acceptance tests. Isolated data disables startup and scheduler changes unless `TOKENFLOW_SYSTEM_TEST=1`. `TOKENFLOW_EXECUTABLE` selects a packaged executable. Test commands are enabled only when `TOKENFLOW_ACCEPTANCE_REPORT` is explicitly set and accept requests only from local windows.
