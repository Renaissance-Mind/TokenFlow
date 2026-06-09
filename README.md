# TokenUsage

Installable local collector for TokenUsage. It scans local AI-agent session logs, aggregates token usage into half-hour buckets, and uploads only counts/cost metadata to TokenUsage_Server.

## Supported Agents

- Codex: `~/.codex/sessions/**/rollout-*.jsonl`
- Claude Code: `~/.claude/projects/**/*.jsonl`
- Gemini CLI: `~/.gemini/tmp/**/chats/session-*.json`
- OpenCode: `~/.local/share/opencode/opencode.db`
- cc-switch: `~/.cc-switch/cc-switch.db` model pricing, and `proxy_request_logs` usage when `CC_SWITCH_DB` is set explicitly

Prompts and responses are not uploaded.

OpenCode support reads the local SQLite database and requires `sqlite3` on `PATH`.

cc-switch support also requires `sqlite3` on `PATH`. TokenUsage reads `model_pricing` from the default cc-switch database when present so local pricing follows cc-switch. To avoid double-counting alongside native Codex/Claude/Gemini logs, cc-switch `proxy_request_logs` usage is imported only when you set `CC_SWITCH_DB=/path/to/cc-switch.db`.

## Install and Link

From this repository before npm publication:

```bash
npm install
npm install -g .
tokenusage init --server-url https://usage.example.com
```

`npm install -g .` runs the package `prepare` script, so the CLI is compiled before npm links `dist/cli.js`.

If you want the auto-sync job to run this local checkout before publishing to npm, pin the scheduler command explicitly:

```bash
TOKENUSAGE_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenUsage/dist/cli.js sync --auto" \
  tokenusage init --server-url https://usage.example.com
```

After publishing the package:

```bash
npx --yes tokenusage init --server-url https://usage.example.com
```

`init` writes `~/.tokenusage/config.json`, installs a 10-minute auto-sync job on macOS launchd or Linux systemd user timers, then opens a browser device-link flow. Sign in on the server with GitHub or Google and approve the device.

If you create a `read_write` API key in the server dashboard, a machine can upload without the browser device-link flow:

```bash
tokenusage init --server-url https://usage.example.com --api-token tu_api_...
```

Use only `read_write` keys for uploads. `read_only` keys are for dashboards, API reads, and public heatmap embeds.

For local development against the server in `../TokenUsage_Server`:

```bash
tokenusage init --server-url http://127.0.0.1:8787
```

## Commands

```bash
tokenusage login --server-url https://usage.example.com
tokenusage login --server-url https://usage.example.com --api-token tu_api_...
tokenusage sync
tokenusage status
tokenusage update --source /Users/chunqiu/Documents/workspace/TokenUsage
tokenusage logout
```

- `sync` scans local logs, aggregates buckets, uploads idempotently, and records a sync heartbeat. It uses a configured `read_write` API key first, otherwise the linked device token. If a model has no local pricing rule, sync still uploads the usage bucket and reports how many buckets are unpriced.
- `status` shows local config, verifies the linked device with the server when logged in, identifies API-token upload mode, and prints source paths, event counts, bucket counts, and unpriced bucket counts.
- `update` upgrades the global package and refreshes the auto-sync scheduler. Use `--source /path/to/TokenUsage` before npm publication, or omit `--source` after publishing to update from `tokenusage@latest`.

## Pricing Coverage

TokenUsage prices buckets only when the local pricing table recognizes the model. Unknown models are still counted and uploaded with `pricing_status: "unpriced"`, but their cost fields are recorded as `$0.000000` until a matching pricing rule is added. This keeps token totals accurate while making undercounted cost totals visible in local `status`, manual `sync`, and the server dashboard/API.

Known priced buckets are uploaded with `pricing_status: "priced"`. The server aggregates both statuses and surfaces the unpriced bucket count so dashboard totals are not mistaken for exact billing when new model names appear before the pricing table is updated.

## Configuration

Environment overrides:

- `TOKENUSAGE_HOME`: local state directory, default `~/.tokenusage`
- `TOKENUSAGE_SERVER_URL`: default server URL
- `TOKENUSAGE_AUTO_SYNC_COMMAND`: command written into launchd/systemd for automatic sync, default `npx --yes tokenusage@latest sync --auto`
- `CODEX_HOME`: Codex config home, default `~/.codex`
- `CLAUDE_HOME`: Claude config home, default `~/.claude`
- `GEMINI_HOME`: Gemini config home, default `~/.gemini`
- `OPENCODE_DB`: OpenCode SQLite database path override
- `OPENCODE_HOME`: OpenCode data home override, default `~/.local/share/opencode`
- `XDG_DATA_HOME`: used for OpenCode when `OPENCODE_DB` and `OPENCODE_HOME` are unset
- `CC_SWITCH_DB`: cc-switch SQLite database path. When set, TokenUsage imports cc-switch `proxy_request_logs` usage and `model_pricing`; when unset, only the default `~/.cc-switch/cc-switch.db` pricing table is used if it exists.

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js status
```
