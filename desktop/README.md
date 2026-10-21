<p align="center"><img src="../docs/assets/tokenflow.svg" alt="TokenFlow" width="112" height="112"></p>

# TokenFlow Desktop

TokenFlow Desktop is a Dashboard, Settings page, and menu bar/system tray popup backed by the same CLI used in the terminal.

## Installation and shared CLI

Install the macOS DMG or the Windows EXE. On startup, App finds an existing TokenFlow CLI and reuses its configuration and login. CLI versions with desktop protocol 2 and the background-collector capability are supported (starting with 0.2.78). An older installation, including the legacy `tokenusage` package, is shown in Settings with an upgrade action. Upgrading keeps its terminal entrypoint and existing configuration.

If no CLI is installed, App installs and configures a standalone CLI under the collector's data directory. Release installers include a checksummed official Node.js runtime, SQLite, and the CLI's dependencies; users do not need Node.js or npm. The terminal launchers use the active CLI recorded in `cli-installation.json`. A compatible global CLI installed later can become the active installation without leaving App on another collector.

The macOS installer adds `~/.local/bin` to the user's shell login profile. Windows installs launchers under the user's Local AppData directory and adds them to the user's PATH. Open a new terminal to use `tokenflow` or the compatibility command `tokenusage`. Removing or quitting App retains the standalone CLI and its data.

Existing `~/.tokenflow/config.json` and legacy `~/.tokenusage/config.json` are reused. App reads the CLI’s atomic statistics cache directly. It uses private stdio for manual collection, sync, token validation, and configuration changes. It does not run a separate collector or require a local HTTP port. Sync and credential changes share the CLI's lock. Browser sign-in reuses an existing device, and account changes clear the upload ledger so the new account receives a full snapshot.

## Dashboard, Settings, and tray

App always opens the canonical web Dashboard, bundled with its chart, UI, and persona assets for offline use. The same layout, charts, date ranges, and device/agent/model filters work before and after sign-in. Without account authorization, the data adapter reads this device's CLI usage cache. At startup the App can show those saved local statistics while it confirms account access. Once signed in, it saves successful account Dashboard responses by server, account, and request; reopening the same range shows the saved response while a fresh request updates it. Opening or focusing a window does not start collection. The CLI runs independently, checks source metadata every 15 seconds, and publishes changed statistics atomically. Its first pass reads existing history once; later passes reuse unchanged files and resume append-only plain logs from saved byte offsets with bounded head/tail checks, including concurrent appends. A manual Refresh retains measured collection progress. Local results are published before network pricing and uploads finish.

Account, token, server, device name, and automatic-sync preferences are read from and written to the active CLI configuration. App sign-in, sign-out, and account switching immediately apply to terminal commands; CLI changes update Settings while App is open. Switch account opens the existing browser/token controls and retains the current login until the replacement is approved. Language, popup layout/range/appearance, menu bar display, and App startup preferences are stored separately in App settings.

The first statistics load shows a spinning indicator until data is ready. The signed-out Dashboard has a sign-in icon in its top-left corner; the toolbar uses accessible icon buttons. The sign-in dialog offers GitHub and Google, and connects automatically after browser sign-in. Local All-time summaries support history longer than one year.

Settings opens inside the existing main window as a light page; returning to Dashboard retains its DOM, filters, charts, and window bounds. The section navigation stays in the same window; Menu bar popup opens its visual editor. Dashboard and Settings share one 56px draggable toolbar with native window controls and compact progress. Progress appears in that row without moving page content; smaller windows prioritize counts and actions, and macOS full screen releases the traffic-light safe area. Local reading reports discovered and processed file counts and measured percentage, with byte details on hover. HTTP fetching reports completed/total requests, with received bytes in its full accessible label and tooltip; a trustworthy Content-Length gives byte-based percentage, otherwise percentage follows completed requests. Downloads use the updater's actual percentage. Authorization and CLI installation keep an activity indicator while their total work is unknown. The tray retains its separate progress display.

Settings contains browser sign-in with GitHub or Google, a read-write API token field, server and device settings, language, startup, automatic sync, and App/CLI update controls. An existing CLI device login or API token automatically opens the synced account Dashboard. App validates and reuses the same credential, including after a CLI login/account change or App restart; no second browser authorization is required. Active device credentials can read their owning account's usage, but account and administrator mutations still require the existing session authorization. Tokens are never sent to the local renderer. Desktop browser credentials use the OS credential store; collector credentials retain CLI-compatible private file storage.

There is one Dashboard with no local/cloud page or selector. Signing in, signing out, and network recovery switch its data adapter without navigation or replacing the page. Only bundled scripts run in the sandboxed renderer. A narrow native API broker handles credentials and returns usage data; remote HTML is never loaded. If the server is unavailable, the same Dashboard uses this device's data. Login, tokens, and update controls live in Settings.

The tray popup is a miniature Dashboard using the canonical overview, trend, model-share, activity, token-mix, device-share, cache-hit, and output modules and API adapter. It follows App's existing CLI authorization: signed-out usage is local, signed-in usage is synced. Settings → Menu bar popup opens a light visual editor: the real popup appears in the center, with a searchable widget library on the right. Click to add or drag widgets into the preview, drag handles to reorder, use arrow keys on a focused handle, or remove widgets. A blue insertion line marks the drop position; at least one widget remains. Today/7D/30D and system/light/dark update the preview, and Done saves the ordered layout for the actual popup. Restore defaults resets the draft layout. Editing does not change CLI configuration, and drafts survive language changes and collection progress. The preview frame has no Electron preload: its parent brokers only read-only usage requests, while editing controls remain in Settings. Feather icons are bundled under their MIT license.

The popup gear opens this editor in the existing Settings window. Layout height follows the selected modules, scrolls when needed, and stays inside the clicked display. Refresh, Open Dashboard, and Settings remain icons in its header. Presentation preferences can be changed during collection without changing CLI connection settings.

Closing a window keeps App resident in the tray. Quit stops the App, while macOS launchd keeps the standalone CLI collector running. The CLI checks for source changes every 15 seconds and uploads every ten minutes. The same scheduled task is used by CLI and App installations. A CLI process lock elects one background collector. Manual collection and account changes ask it to yield and share the CLI sync lock. Pausing is stored in shared CLI configuration and also applies after App quits; manual sync remains available. Windows runs the same background CLI while App is resident.

Interactive CLI requests use App's Chromium networking, including its system proxy configuration. The independent background collector uses CLI networking. Collection is cancellable when signing in, disconnecting, or quitting, and has a five-minute limit. Only aggregated usage metadata is uploaded; prompts, responses, session IDs, and source paths remain local.

The current desktop entrypoint is the Electron App on `main` (0.1.18), backed by the shared CLI (0.2.79). The earlier Tauri migration remains available on `caopu/tokenflow-tauri` and in Git history; it is not the default desktop runtime on `main`.

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
node desktop/scripts/cache-smoke.mjs
TOKENFLOW_AUTH_TEST_SERVER=/absolute/path/TokenFlow_Server/scripts/desktop-test-server.mjs node desktop/scripts/background-sync-smoke.mjs
TOKENFLOW_AUTH_TEST_SERVER=/absolute/path/TokenFlow_Server/scripts/desktop-test-server.mjs node desktop/scripts/auth-smoke.mjs
```

The checks exercise real CLI processes, shared configuration, legacy upgrades, cancellation and lock release, SQLite/WAL reads, the same Dashboard across authorization and local/cloud data changes, Settings, loading animation, tray residency, and a real Worker/D1 authorization backend. Provider identity is an isolated signed-in fixture; external GitHub/Google verification requires real browser sign-in.

`TOKENFLOW_CLI_PATH` selects an explicit `dist/cli.js`. `TOKENFLOW_NODE_PATH` selects a system runtime for development. `TOKENFLOW_HOME`, `TOKENFLOW_DESKTOP_DATA`, and `TOKENFLOW_SCAN_HOME` isolate acceptance tests; an isolated App data directory disables system scheduler/PATH changes and automatic attachment to global CLIs. `TOKENFLOW_EXECUTABLE` selects a packaged App for smoke tests.

The canonical page snapshot is refreshed explicitly from the server checkout:

```sh
node desktop/scripts/sync-dashboard.mjs /absolute/path/TokenFlow_Server
```

The approved logo lives in `docs/assets/tokenflow.svg`. Desktop builds derive the application icon, transparent color tray icon and monochrome macOS template icons from that SVG. To refresh the web logo, SVG/ICO favicons and Apple touch icon in a server checkout, run `node desktop/scripts/prepare-brand.mjs /absolute/path/TokenFlow_Server/public` from the repository root. Keep the server's committed assets and the offline Dashboard snapshot in sync after changing the logo.

The snapshot includes the web Dashboard's ECharts version, Inter fonts, animal personas, and identity poster exporter. Refreshing it checks the CLI adapter integration points and fails if the web page has changed them. Normal builds use these checked-in offline assets; the server checkout is not required to run or package App.

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
