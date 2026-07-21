# ccusage Parity Status

Last checked: 2026-07-21

Reference ccusage commit: `31e084a fix(ci): update publint fetcherVersion and apply treefmt (#1469)`

## Summary

TokenFlow now supports every ccusage local source adapter that can be consumed without requiring a new user-side telemetry setup, except GitHub Copilot CLI OpenTelemetry export.

TokenFlow intentionally stores agent and model separately, so adapter display prefixes used by ccusage, such as `[pi]` or `[openclaw]`, are not copied into `model`. This keeps pricing resolution shared across agents and lets the dashboard distinguish sources by the `agent` field.

The 2026-07-02 parity pass found ccusage main was still packaged as `v20.0.14` but had added Codex fast/priority pricing behavior after the last TokenFlow sync. TokenFlow reads existing `CODEX_HOME/config.toml` when present and, if `service_tier` is `fast` or `priority`, applies ccusage-compatible Codex price multipliers: `gpt-5.5` variants use `2.5x`, `gpt-5.4` and `gpt-5.3-codex` variants use `2x`, and other fast Codex models use ccusage's `2x` fallback. This is a local config read only; it does not require new telemetry, permissions, or user setup.

The 2026-07-10 parity pass found ccusage main packaged as `v20.0.16` and added directly migratable pricing behavior in `726ecb3 feat(pricing): support OpenAI two-stage pricing and add the gpt-5.6 family (#1414)`. TokenFlow now includes the `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` pricing rows, fills ccusage's OpenAI long-context tier rates for the `gpt-5.6`, `gpt-5.5`, and `gpt-5.4` families, and applies ccusage's 272K-input two-stage rule: a request above the threshold is billed entirely at long-context input, output, cache-read, and cache-write rates. Because TokenFlow aggregates to half-hour buckets, it also tracks internal per-request long-context token splits before aggregation so a bucket containing both short and long Codex requests is priced like ccusage rather than treating the whole bucket as one request.

The 2026-07-21 parity pass found ccusage main packaged as `v20.0.18` and added directly migratable pricing behavior in `fe1c900 feat(pricing): embed Moonshot/Kimi models from models.dev (#1464)`. TokenFlow now includes the new embedded Moonshot/Kimi rows that affect local model resolution, including Kimi K3, Kimi K2.7 Code, and Kimi K2.6/K2.5 fast, flex, lightning, nitro, and highspeed variants. This is pricing-data-only parity; it does not add a new source path, parser, telemetry requirement, permission, or user workflow.

The 2026-07-10 pass also showed non-pricing drift in Kimi Code paths and `usage.record` parsing, Pi named store configuration, unified report `--sections`/`--by-agent` output, Codex fork replay filtering, JSON model breakdown reporting, statusline display text, release automation, and pricing lookup caching. Those changes were not copied because they are adapter, parser, loader, reporting, performance, or release-surface changes rather than directly migratable pricing behavior for TokenFlow's local collector model.

## Source Adapter Matrix

| ccusage adapter | TokenFlow status | Notes |
| --- | --- | --- |
| `claude` | Supported | Claude Code project JSONL usage. Includes fast/regular split when Claude Code exposes it. |
| `codex` | Supported | Codex rollout JSONL token counts. Reads existing `CODEX_HOME/config.toml` to mirror ccusage fast/priority pricing multipliers. |
| `gemini` | Supported | Gemini CLI session JSON files. |
| `opencode` | Supported | OpenCode SQLite `message` rows from `opencode.db` and `opencode-*.db`, plus standalone `storage/message/**/*.json` files. Requires `sqlite3` for DB rows. |
| `kimi` | Supported | Kimi wire JSONL plus config model metadata and K2.5/K2.6 pricing cutoff. ccusage added `~/.kimi-code` `usage.record` support as non-pricing parser/path drift; TokenFlow did not copy it in the 2026-07-10 pricing sync. |
| `qwen` | Supported | Qwen Code assistant `usageMetadata` rows. |
| `amp` | Supported | Amp thread JSON, both `usageLedger.events[]` and direct assistant `messages[].usage`. |
| `codebuff` | Supported | Codebuff/Manicode chat messages, metadata usage, and run-state provider usage fallback. |
| `droid` | Supported | Droid `*.settings.json` snapshots, latest snapshot per session, model normalization, sidecar model fallback. |
| `goose` | Supported | Goose `sessions.db`, accumulated token columns preferred. Requires `sqlite3`. |
| `hermes` | Supported | Hermes `state.db`, positive recorded cost is trusted, recorded zero cost falls back to token pricing. Requires `sqlite3`. |
| `kilo` | Supported | Kilo `kilo.db` message rows. Requires `sqlite3`. |
| `openclaw` | Supported | OpenClaw-compatible JSONL sessions and archived/reset JSONL names, with model-change fallback state. |
| `pi` | Supported | Pi agent session JSONL assistant usage rows. ccusage named pi-format stores are non-pricing config/reporting drift and were not copied in the 2026-07-10 pricing sync. |
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
