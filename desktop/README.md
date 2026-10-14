# TokenFlow Desktop

TokenFlow Desktop is a Dashboard, Settings page, and menu bar/system tray popup backed by the same CLI used in the terminal.

## Installation and shared CLI

Install the macOS DMG or the Windows EXE. On startup, App finds an existing TokenFlow CLI and reuses its configuration and login. CLI versions with desktop protocol 2 are supported (starting with 0.2.73). An older installation, including the legacy `tokenusage` package, is shown in Settings with an upgrade action. Upgrading keeps its terminal entrypoint and existing configuration.

If no CLI is installed, App installs and configures a standalone CLI under the collector's data directory. Release installers include a checksummed official Node.js runtime, SQLite, and the CLI's dependencies; users do not need Node.js or npm. The terminal launchers use the active CLI recorded in `cli-installation.json`. A compatible global CLI installed later can become the active installation without leaving App on another collector.

The macOS installer adds `~/.local/bin` to the user's shell login profile. Windows installs launchers under the user's Local AppData directory and adds them to the user's PATH. Open a new terminal to use `tokenflow` or the compatibility command `tokenusage`. Removing or quitting App retains the standalone CLI and its data.

Existing `~/.tokenflow/config.json` and legacy `~/.tokenusage/config.json` are reused. App uses CLI processes over private stdio for local reading, sync, token validation, and configuration changes. It does not run a separate collector or require a local HTTP port. Sync and credential changes share the CLI's lock. Browser sign-in reuses an existing device, and account changes clear the upload ledger so the new account receives a full snapshot.

## Dashboard, Settings, and tray

App always opens the canonical web Dashboard, bundled with its chart, UI, and persona assets for offline use. The same layout, charts, date ranges, and device/agent/model filters work before and after sign-in. Without account authorization, the data adapter reads this device's CLI usage cache; after sign-in, it reads synced account data. Reading local records shows a loading animation, and the cache is published before network pricing and uploads finish.

Account, token, server, device name, and automatic-sync preferences are read from and written to the active CLI configuration. App sign-in, sign-out, and account switching immediately apply to terminal commands; CLI changes update Settings while App is open. Switch account opens the existing browser/token controls and retains the current login until the replacement is approved. Only language, menu bar display, and App startup preferences are stored separately in App settings.

Settings opens inside the existing main window as a light page; returning to Dashboard retains its DOM, filters, charts, and window bounds. The section navigation scrolls the same page. A shared top progress strip shows local reading, pricing, cloud data requests, authorization, CLI installation, and App update checks. Local reading reports discovered and processed file counts, bytes read, and measured percentage. HTTP fetching reports completed/total requests and received bytes; a trustworthy Content-Length gives byte-based percentage, otherwise percentage follows completed requests. Downloads use the updater's actual percentage. Authorization and CLI installation keep an activity indicator while their total work is unknown.

Settings contains browser sign-in with GitHub or Google, a read-write API token field, server and device settings, language, startup, automatic sync, and App/CLI update controls. An existing CLI device login or API token automatically opens the synced account Dashboard. App validates and reuses the same credential, including after a CLI login/account change or App restart; no second browser authorization is required. Active device credentials can read their owning account's usage, but account and administrator mutations still require the existing session authorization. Tokens are never sent to the local renderer. Desktop browser credentials use the OS credential store; collector credentials retain CLI-compatible private file storage.

There is one Dashboard with no local/cloud page or selector. Signing in, signing out, and network recovery switch its data adapter without navigation or replacing the page. Only bundled scripts run in the sandboxed renderer. A narrow native API broker handles credentials and returns usage data; remote HTML is never loaded. If the server is unavailable, the same Dashboard uses this device's data. Login, tokens, and update controls live in Settings.

The tray popup shows local usage, sync/read progress, and shortcuts to Dashboard and Settings. Closing a window keeps App resident in the tray. Quit stops the App, while macOS launchd continues invoking the standalone CLI every ten minutes. The same scheduled task is used by CLI and App installations. App owns collection while running, so scheduled CLI sync yields. Pausing is stored in shared CLI configuration and also applies after App quits; manual sync remains available. Windows automatic collection runs while App is resident.

CLI requests use App's Chromium networking while App is running, including its system proxy configuration. Collection is cancellable when signing in, disconnecting, or quitting, and has a five-minute limit. Only aggregated usage metadata is uploaded; prompts, responses, session IDs, and source paths remain local.

## Development and verification

Use Node.js 24 or newer for App development. The standalone CLI continues to support Node.js 20 or newer, using external sqlite3 on versions without built-in SQLite.

```sh
npm ci
npm ci --prefix desktop
node desktop/node_modules/electron/install.js
npm start --prefix desktop
```

Some npm configurations skip installation scripts. The explicit Electron step downloads its runtime in that case. Development uses an installed system Node runtime; packaged apps install their independent bundled runtime.

```sh
npm test
npm run typecheck
npm run build --prefix desktop
npm test --prefix desktop
npm run smoke --prefix desktop
TOKENFLOW_AUTH_TEST_SERVER=/absolute/path/TokenFlow_Server/scripts/desktop-test-server.mjs node desktop/scripts/auth-smoke.mjs
```

The checks exercise real CLI processes, shared configuration, legacy upgrades, cancellation and lock release, SQLite/WAL reads, the same Dashboard across authorization and local/cloud data changes, Settings, loading animation, tray residency, and a real Worker/D1 authorization backend. Provider identity is an isolated signed-in fixture; external GitHub/Google verification requires real browser sign-in.

`TOKENFLOW_CLI_PATH` selects an explicit `dist/cli.js`. `TOKENFLOW_NODE_PATH` selects a system runtime for development. `TOKENFLOW_HOME`, `TOKENFLOW_DESKTOP_DATA`, and `TOKENFLOW_SCAN_HOME` isolate acceptance tests; an isolated App data directory disables system scheduler/PATH changes and automatic attachment to global CLIs. `TOKENFLOW_EXECUTABLE` selects a packaged App for smoke tests.

The canonical page snapshot is refreshed explicitly from the server checkout:

```sh
node desktop/scripts/sync-dashboard.mjs /absolute/path/TokenFlow_Server
```

Normal builds use the checked-in snapshot and bundle Shoelace from the pinned npm dependency. The server checkout is not required to run or package App.

## Build and distribution

```sh
npm run dist:mac --prefix desktop -- --publish never
npm run dist:win --prefix desktop -- --publish never
node desktop/scripts/packaged-smoke.mjs
```

Builds download the official Node 24 runtime for each target architecture and verify its SHA-256 digest before packaging. macOS produces Apple Silicon and Intel DMGs and ZIPs. Windows produces an x64 NSIS installer. Packaged checks copy App outside the repository and verify it can install and use its standalone CLI without development dependencies. Windows installer checks must run on Windows.

Set `CSC_NAME` or electron-builder certificate variables for signing. Public Mac distribution also needs notarization configured with the distributor's Apple credentials. CI builds remain unsigned unless signing is configured.

App updates use GitHub releases tagged `desktop-vX.Y.Z`, separately from npm CLI releases. Upload installers, update YAML files, and blockmaps to that release. CLI upgrades in Settings install the version shipped with App; if npm has a newer version, update via `tokenflow update` or install a newer App. Local builds do not publish anything.

CLI sign-in reuse requires the server Dashboard read endpoints to accept active device credentials. This permission update requires no database migration. The server migration `0009_desktop_auth.sql` and desktop authorization endpoints must be deployed for browser sign-in. API-token data access uses existing account usage APIs and does not load the server `/dashboard` page. Deploy migrations before the Worker. Existing OAuth settings and callback URLs still apply.
