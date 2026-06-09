# TokenUsage

**Language:** English | [简体中文](docs/i18n/README.zh-CN.md) | [繁體中文](docs/i18n/README.zh-TW.md) | [日本語](docs/i18n/README.ja.md) | [한국어](docs/i18n/README.ko.md) | [Español](docs/i18n/README.es.md) | [Türkçe](docs/i18n/README.tr.md) | [Русский](docs/i18n/README.ru.md)

> Private, local-first token accounting for the AI agents you actually use.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenusage?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[Features](#features) - [Install](#install) - [Quick Start](#quick-start) - [Commands](#commands) - [Configuration](#configuration) - [Development](#development)

TokenUsage is an installable local collector for multi-device AI-agent usage accounting. It scans local Codex, Claude Code, Gemini CLI, OpenCode, and cc-switch usage data, aggregates token counts into UTC daily buckets by agent and model, calculates known costs, and uploads only usage metadata to a TokenUsage server.

Prompts and responses stay on your machine. Uploaded payloads contain counts, model names, bucket timestamps, pricing status, and optional device metadata.

## Preview

```bash
$ tokenusage status
TokenUsage status
Config: /Users/alice/.tokenusage/config.json
Server: https://tokenusage.renaissancemind.ai
Device: dev_...
Token: set (device)
Remote: linked
Local events: 1842
Local buckets: 37
Source codex: found (219 files) /Users/alice/.codex/sessions
Source claude: found (64 files) /Users/alice/.claude/projects
Source gemini: missing (0 files) /Users/alice/.gemini/tmp
Source opencode: found (1 files) /Users/alice/.local/share/opencode/opencode.db
Home: /Users/alice/.tokenusage
```

## Features

- 🔐 **Local-first collection** - reads agent logs locally and uploads metadata only.
- 🤖 **Multi-agent support** - Codex, Claude Code, Gemini CLI, OpenCode, and cc-switch.
- 📊 **Daily UTC buckets** - aggregates usage by day, agent, and model for stable dashboards.
- 💸 **Cost-aware accounting** - separates fresh input, cached input, cache creation, output, and reasoning output tokens.
- 🧾 **Unpriced model visibility** - unknown models are counted and marked as `unpriced` instead of silently disappearing.
- 🔁 **Automatic sync** - installs a 10-minute macOS `launchd` or Linux systemd user timer.
- 🔑 **Device login or API key upload** - supports browser device linking and `read_write` API tokens.
- 🛠️ **Self-host friendly** - point the CLI at any compatible TokenUsage server URL.

## Supported Sources

| Source | Local data read | Notes |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` and archived session JSONL | Parses local rollout token events. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Parses project JSONL usage data. |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Parses Gemini session JSON files. |
| OpenCode | `~/.local/share/opencode/opencode.db` | Requires `sqlite3` on `PATH`. |
| cc-switch | `~/.cc-switch/cc-switch.db` | Reads pricing by default; imports `proxy_request_logs` only when `CC_SWITCH_DB` is set. |

TokenUsage intentionally does not upload source file paths, session IDs, prompts, or responses.

## Install

TokenUsage requires Node.js 20 or newer.

```bash
npm install -g @renaissancemind/tokenusage
```

If you want OpenCode or cc-switch support, make sure `sqlite3` is available:

```bash
sqlite3 --version
```

From a local checkout before npm publication:

```bash
npm install
npm install -g .
```

`npm install -g .` runs the package `prepare` script, so the TypeScript CLI is compiled before npm links `dist/cli.js`.

## Quick Start

### 1. Link this machine

```bash
tokenusage login
```

By default, `login` uses `https://tokenusage.renaissancemind.ai`. It prints a verification URL and user code, opens the browser when possible, stores the approved device token in `~/.tokenusage/config.json`, then runs one initial `sync`.

To use a self-hosted server:

```bash
tokenusage login --server-url http://127.0.0.1:8787
```

To link the machine without the initial upload:

```bash
tokenusage login --no-sync
```

### 2. Check what will be scanned

```bash
tokenusage status
```

`status` shows local source paths, parsed event counts, bucket counts, unpriced bucket counts, config location, and remote auth status when a token is configured.

### 3. Sync usage

```bash
tokenusage sync
```

`sync` scans local logs, aggregates usage, uploads idempotent buckets, records a sync heartbeat, and reports parsed events and uploaded buckets.

### 4. Install automatic sync

```bash
tokenusage init
```

`init` writes `~/.tokenusage/config.json`, installs automatic sync every 10 minutes on macOS or Linux, then starts the browser device-link flow unless a token already exists.

## API Token Mode

Browser device linking is convenient for personal machines. For servers, CI-style machines, or scripted installs, use a `read_write` API key from the TokenUsage server dashboard:

```bash
tokenusage init --server-url https://tokenusage.renaissancemind.ai --api-token tu_api_...
```

Only `read_write` keys can upload usage. `read_only` keys are for dashboards, API reads, and public heatmap embeds; the CLI rejects read-only keys during `init` and `login`.

## Commands

```bash
tokenusage init --server-url https://tokenusage.renaissancemind.ai
tokenusage login --server-url https://tokenusage.renaissancemind.ai
tokenusage login --server-url https://tokenusage.renaissancemind.ai --api-token tu_api_...
tokenusage sync
tokenusage status
tokenusage update [--source @renaissancemind/tokenusage@latest|/path/to/TokenUsage]
tokenusage logout
```

| Command | What it does |
| --- | --- |
| `init` | Writes config, installs auto-sync, and optionally starts login. |
| `login` | Links a browser-approved device token or stores a validated upload API token, then runs an initial sync unless `--no-sync` is set. |
| `sync` | Parses local usage, builds UTC daily buckets, uploads them, and updates `lastSyncAt`. |
| `status` | Prints local config, source availability, bucket counts, auth status, and unpriced models. |
| `update` | Reinstalls the global package and refreshes the auto-sync scheduler. |
| `logout` | Removes local upload tokens while keeping non-secret config. |

## Pricing Model

TokenUsage calculates costs locally before upload.

- Built-in pricing covers known Codex, Claude, and Gemini model IDs.
- cc-switch `model_pricing` can extend or override local pricing when its database exists.
- Unknown models are still counted and uploaded with `pricing_status: "unpriced"`.
- Unpriced buckets record cost as `$0.000000` so token totals remain accurate and cost gaps stay visible.
- For Codex and Gemini, cached input is treated as part of reported input and is separated before cost calculation to avoid double-counting.

## Configuration

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `TOKENUSAGE_HOME` | Local state directory. Defaults to `~/.tokenusage`. |
| `TOKENUSAGE_SERVER_URL` | Default server URL. |
| `TOKENUSAGE_AUTO_SYNC_COMMAND` | Command written into launchd/systemd. Defaults to `npx --yes @renaissancemind/tokenusage@latest sync --auto`. |
| `TOKENUSAGE_UPDATE_SOURCE` | Package/source used by `tokenusage update` when `--source` is omitted. |
| `CODEX_HOME` | Codex config home. Defaults to `~/.codex`. |
| `CLAUDE_HOME` | Claude config home. Defaults to `~/.claude`. |
| `GEMINI_HOME` | Gemini config home. Defaults to `~/.gemini`. |
| `OPENCODE_DB` | Explicit OpenCode SQLite database path. |
| `OPENCODE_HOME` | OpenCode data home. Defaults to `~/.local/share/opencode`. |
| `XDG_DATA_HOME` | Used to resolve OpenCode data when `OPENCODE_DB` and `OPENCODE_HOME` are unset. |
| `CC_SWITCH_DB` | Explicit cc-switch SQLite path. Enables `proxy_request_logs` import and pricing reads. |

### Local checkout in auto-sync

Before publishing to npm, pin the scheduler to this checkout:

```bash
TOKENUSAGE_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenUsage/dist/cli.js sync --auto" \
  tokenusage init --server-url https://tokenusage.renaissancemind.ai
```

After publishing, the default scheduler command can use npm:

```bash
npx --yes @renaissancemind/tokenusage init --server-url https://tokenusage.renaissancemind.ai
```

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

The source is a small TypeScript CLI:

- `src/cli.ts` - command routing and user-facing behavior.
- `src/file-scan.ts` - local agent discovery and parsing entrypoint.
- `src/sources/*` - source-specific parsers.
- `src/usage-buckets.ts` - UTC bucket aggregation.
- `src/pricing.ts` - pricing resolution and cost calculation.
- `src/api.ts` - device flow, token validation, and ingest calls.
- `src/scheduler.ts` - macOS launchd and Linux systemd timer installation.

## Limitations

- OpenCode and cc-switch database reads require the `sqlite3` CLI.
- Automatic sync is installed only on macOS and Linux; other platforms can run `tokenusage sync` manually or wire their own scheduler.
- cc-switch request logs are not imported unless `CC_SWITCH_DB` is set explicitly, which avoids double-counting alongside native Codex, Claude, and Gemini logs.
- Costs for unknown model IDs are intentionally marked `unpriced` until a pricing rule exists.

## Documentation

This README is the primary user documentation for the CLI. For implementation details, start with the focused tests in `test/` and the TypeScript modules in `src/`.

## Contributing

Issues and pull requests are welcome. Please include a focused test for parser, pricing, scheduler, or command behavior changes.

## License

No license file is currently included in this repository.
