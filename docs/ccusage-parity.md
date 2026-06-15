# ccusage Parity Status

Last checked: 2026-06-15

Reference ccusage commit: `10e3730 chore: release v20.0.13`

## Summary

TokenFlow now supports every ccusage local source adapter that can be consumed without requiring a new user-side telemetry setup, except GitHub Copilot CLI OpenTelemetry export.

TokenFlow intentionally stores agent and model separately, so adapter display prefixes used by ccusage, such as `[pi]` or `[openclaw]`, are not copied into `model`. This keeps pricing resolution shared across agents and lets the dashboard distinguish sources by the `agent` field.

The 2026-06-15 parity pass found no new ccusage adapter, loader path, parser, pricing snapshot, or privacy-surface behavior that needed a TokenFlow collector change. The directly migratable delta was ccusage's pricing fix for `CCUSAGE_MODEL_ALIASES`: pricing now tries the known original model before falling back to the configured alias. TokenFlow mirrors that behavior and also preserves the original priced model in bucket `pricingModel` when a configured alias is only a display label, including Claude fast buckets.

## Source Adapter Matrix

| ccusage adapter | TokenFlow status | Notes |
| --- | --- | --- |
| `claude` | Supported | Claude Code project JSONL usage. Includes fast/regular split when Claude Code exposes it. |
| `codex` | Supported | Codex rollout JSONL token counts. Codex fast behavior remains unchanged from TokenFlow's existing Codex handling. |
| `gemini` | Supported | Gemini CLI session JSON files. |
| `opencode` | Supported | OpenCode SQLite `message` rows. Requires `sqlite3`. |
| `kimi` | Supported | Kimi wire JSONL plus config model metadata and K2.5/K2.6 pricing cutoff. |
| `qwen` | Supported | Qwen Code assistant `usageMetadata` rows. |
| `amp` | Supported | Amp thread JSON, both `usageLedger.events[]` and direct assistant `messages[].usage`. |
| `codebuff` | Supported | Codebuff/Manicode chat messages, metadata usage, and run-state provider usage fallback. |
| `droid` | Supported | Droid `*.settings.json` snapshots, latest snapshot per session, model normalization, sidecar model fallback. |
| `goose` | Supported | Goose `sessions.db`, accumulated token columns preferred. Requires `sqlite3`. |
| `hermes` | Supported | Hermes `state.db`, positive recorded cost is trusted, recorded zero cost falls back to token pricing. Requires `sqlite3`. |
| `kilo` | Supported | Kilo `kilo.db` message rows. Requires `sqlite3`. |
| `openclaw` | Supported | OpenClaw-compatible JSONL sessions and archived/reset JSONL names, with model-change fallback state. |
| `pi` | Supported | Pi agent session JSONL assistant usage rows. |
| `copilot` | Deferred | ccusage reads GitHub Copilot CLI OpenTelemetry JSONL from `~/.copilot/otel/*.jsonl` or `COPILOT_OTEL_FILE_EXPORTER_PATH`. This requires users to enable OTEL file export before sessions; older sessions cannot be recovered. Treat as a separate product decision rather than a no-touch local log migration. |
| `all` | Not applicable | ccusage meta-command; TokenFlow already scans all configured local sources during `status` and `sync`. |

## Intentional Differences

| Area | TokenFlow behavior |
| --- | --- |
| Upload privacy | TokenFlow does not upload source file paths, session IDs, prompts, or responses. It uploads aggregated bucket metadata. |
| Aggregation grain | TokenFlow aggregates to UTC half-hour buckets by `agent` and `model`; ccusage reports daily/monthly/session tables locally. |
| Adapter model prefixes | TokenFlow keeps raw normalized model IDs and uses the separate `agent` field instead of ccusage display prefixes. |
| Model aliases | TokenFlow honors `CCUSAGE_MODEL_ALIASES` for ccusage-compatible private/internal model aliases and display aliases. Supported formats are JSON objects such as `{"private-alpha":"gpt-5.5"}` and delimited pairs such as `private-alpha=gpt-5.5;other=claude-sonnet-4`. If the original model already has pricing, TokenFlow keeps the alias as the displayed bucket model while pricing through the original model. |
| Recorded costs | Positive recorded costs are trusted. Hermes recorded zero cost is ignored so pricing can fall back to token counts, matching ccusage's subscription-included behavior. |
| SQLite dependency | OpenCode, Goose, Hermes, and Kilo require the `sqlite3` CLI on `PATH`. |

## Automation Policy

A daily automation monitors ccusage for adapter, parser, loader, path, and pricing drift. It should only auto-implement and publish changes that are directly migratable into TokenFlow's local collector model:

- local JSON, JSONL, or SQLite source files with stable paths;
- token field mapping that can be tested with fixtures;
- pricing aliases or model normalization rules that do not require a new user workflow.

It should not auto-ship changes that require users to enable new telemetry, grant new permissions, log in to another service, or accept a new privacy surface. Those should be recorded and left for product review.
