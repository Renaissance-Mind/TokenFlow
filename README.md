# TokenUsage

Installable local collector for TokenUsage. It scans local AI-agent session logs, aggregates token usage into half-hour buckets, and uploads only counts/cost metadata to TokenUsage_Server.

## Supported Agents

- Codex: `~/.codex/sessions/**/rollout-*.jsonl`
- Claude Code: `~/.claude/projects/**/*.jsonl`
- Gemini CLI: `~/.gemini/tmp/**/chats/session-*.json`

Prompts and responses are not uploaded.

## Install and Link

From this repository before npm publication:

```bash
npm install
npm run build
npm install -g .
tokenusage init --server-url https://usage.example.com
```

After publishing the package:

```bash
npx --yes tokenusage init --server-url https://usage.example.com
```

`init` writes `~/.tokenusage/config.json`, installs a 10-minute auto-sync job on macOS launchd or Linux systemd user timers, then opens a browser device-link flow. Sign in on the server with GitHub or Google and approve the device.

For local development against the server in `../TokenUsage_Server`:

```bash
tokenusage init --server-url http://127.0.0.1:8787
```

## Commands

```bash
tokenusage login --server-url https://usage.example.com
tokenusage sync
tokenusage status
tokenusage update --source /Users/chunqiu/Documents/workspace/TokenUsage
tokenusage logout
```

- `sync` scans local logs, aggregates buckets, uploads idempotently, and records a sync heartbeat.
- `status` shows local config, verifies the linked device with the server when logged in, and prints source paths, event counts, and bucket counts.
- `update` upgrades the global package and refreshes the auto-sync scheduler. Use `--source /path/to/TokenUsage` before npm publication, or omit `--source` after publishing to update from `tokenusage@latest`.

## Configuration

Environment overrides:

- `TOKENUSAGE_HOME`: local state directory, default `~/.tokenusage`
- `TOKENUSAGE_SERVER_URL`: default server URL
- `CODEX_HOME`: Codex config home, default `~/.codex`
- `CLAUDE_HOME`: Claude config home, default `~/.claude`
- `GEMINI_HOME`: Gemini config home, default `~/.gemini`

## Development

```bash
npm install
npm test
npm run build
node dist/cli.js status
```
