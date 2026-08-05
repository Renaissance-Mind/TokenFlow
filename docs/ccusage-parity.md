# ccusage Parity Status

Last checked: 2026-08-05

Reference ccusage commit: `9ad3c77 chore(pricing): update LiteLLM snapshot`

## Summary

TokenFlow now supports every ccusage local source adapter that can be consumed without requiring a new user-side telemetry setup, except GitHub Copilot CLI OpenTelemetry export.

TokenFlow intentionally stores agent and model separately, so adapter display prefixes used by ccusage, such as `[pi]` or `[openclaw]`, are not copied into `model`. This keeps pricing resolution shared across agents and lets the dashboard distinguish sources by the `agent` field.

The 2026-07-02 parity pass found ccusage main was still packaged as `v20.0.14` but had added Codex fast/priority pricing behavior after the last TokenFlow sync. TokenFlow reads existing `CODEX_HOME/config.toml` when present and, if `service_tier` is `fast` or `priority`, applies ccusage-compatible Codex price multipliers: `gpt-5.5` variants use `2.5x`, `gpt-5.4` and `gpt-5.3-codex` variants use `2x`, and other fast Codex models use ccusage's `2x` fallback. This is a local config read only; it does not require new telemetry, permissions, or user setup.

The 2026-07-10 parity pass found ccusage main packaged as `v20.0.16` and added directly migratable pricing behavior in `726ecb3 feat(pricing): support OpenAI two-stage pricing and add the gpt-5.6 family (#1414)`. TokenFlow now includes the `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna` pricing rows, fills ccusage's OpenAI long-context tier rates for the `gpt-5.6`, `gpt-5.5`, and `gpt-5.4` families, and applies ccusage's 272K-input two-stage rule: a request above the threshold is billed entirely at long-context input, output, cache-read, and cache-write rates. Because TokenFlow aggregates to half-hour buckets, it also tracks internal per-request long-context token splits before aggregation so a bucket containing both short and long Codex requests is priced like ccusage rather than treating the whole bucket as one request.

The 2026-07-21 parity pass found ccusage main packaged as `v20.0.18` and added directly migratable pricing behavior in `fe1c900 feat(pricing): embed Moonshot/Kimi models from models.dev (#1464)`. TokenFlow now includes the new embedded Moonshot/Kimi rows that affect local model resolution, including Kimi K3, Kimi K2.7 Code, and Kimi K2.6/K2.5 fast, flex, lightning, nitro, and highspeed variants. This is pricing-data-only parity; it does not add a new source path, parser, telemetry requirement, permission, or user workflow.

The 2026-07-27 parity pass found ccusage main still packaged as `v20.0.18` and added directly migratable Codex pricing behavior in `409b4a5 fix(codex): dedupe replayed usage (#1435)` and `0d968b9 fix(usage): correct replay and pricing accounting (#1438)`. TokenFlow now resolves the default `gpt-5.6` pricing alias through `gpt-5.6-sol`, applies ccusage's explicit `2x` fast multipliers for GPT-5.6 Sol, Terra, and Luna, and honors recorded Codex `thread_settings_applied` service-tier changes per usage event. Recorded `priority` and legacy `fast` turns receive the model's published fast multiplier, recorded `default` and `standard` turns remain standard priced, settings events without `service_tier` preserve the previous tier, and unsupported recorded tiers clear the recorded tier. Unclassified usage still falls back to the existing local `CODEX_HOME/config.toml` read. Models without a published fast multiplier now stay at standard pricing instead of inventing a fallback multiplier, matching ccusage's current API-equivalent cost behavior.

The 2026-07-29 parity pass found ccusage main packaged as `v20.0.19` and added directly migratable pricing-table behavior in `64932e7 chore(pricing): update models.dev snapshot`. TokenFlow now includes the new Claude Opus 5 and Opus 5 fast pricing rows, Kimi K2.7 Code 1100B, provider-qualified Moonshot Kimi K2.7 Code and Kimi K3/K3 Fast rates, and the Hugging Face Kimi K3 snapshot row. Provider-qualified Kimi model ids are preserved internally as pricing keys when an exact migrated row exists, while displayed bucket models remain compact, so existing aggregation and dashboard semantics do not change.

The 2026-07-30 parity pass found ccusage main still packaged as `v20.0.19` and added directly migratable pricing-table behavior in `aa8c7b1 chore(pricing): update models.dev snapshot`. TokenFlow now includes the updated hyphenated `kimi-k2-7-code` and `kimi-k2-7-code-highspeed` rows from the latest models.dev snapshot, including ccusage's new cache-read rates, plus the provider-qualified `moonshotai/Kimi-K3-TEE` pricing row. The dotted `kimi-k2.7-code` rows remain separate because ccusage still carries them as distinct pricing keys with distinct cache-read rates.

The 2026-07-31 parity pass found ccusage main at `90e296e chore(pricing): update LiteLLM snapshot` with models.dev snapshot additions for `anthropic/claude-3-7-sonnet-20250219`, `kimi-k3-eco`, `moonshot-ai/kimi-k2.7-code`, `moonshot-ai/kimi-k3`, and `moonshot/kimi-k2.7-code-highspeed`. TokenFlow added the new `kimi-k3-eco` pricing row. The other added provider-qualified rows already price equivalently through TokenFlow's existing namespace and compact Kimi/Claude model normalization, so they are covered by regression tests without adding duplicate builtin rows.

The 2026-08-01 parity pass found ccusage main at `e93a1fa chore(deps): update rust crate smallvec to 1.15.2 (#1537)`. Its `fd765b4 chore(pricing): update LiteLLM snapshot` pin moved LiteLLM from `79d49620` to `83c256f`, changing only GPT-5.6 pricing entries. TokenFlow now mirrors the lowered GPT-5.6 Terra and Luna standard, cache-read, cache-creation, long-context, and fast-derived rates, and adds exact Bedrock Mantle GPT-5.6 Terra/Luna provider-qualified pricing rows. The new LiteLLM flex long-context fields for GPT-5.6 Sol/Terra/Luna were not copied because TokenFlow does not currently collect a local flex service-tier signal.

The 2026-08-02 parity pass found ccusage main at `11b6862 chore(deps): update dependency vitepress-plugin-group-icons to ^1.7.6 (#1559)`. Its `7fcbda3 chore(pricing): update models.dev snapshot` commit added directly migratable Kimi pricing-table behavior: `Pro/moonshotai/Kimi-K2.5` gained an explicit cache-read rate, `moonshotai/kimi-k2.5` changed input, output, cache-read, cache-write, and context metadata, and `kimi-k3-fast` was added. TokenFlow now preserves the provider-qualified Kimi K2.5 rows internally where exact pricing keys exist and adds the generic Kimi K3 Fast row; display aggregation remains compact when source adapters provide compact model ids.

The 2026-08-04 parity pass found ccusage main at `5fd1591 chore(pricing): update models.dev snapshot`. Its `d0d53aa`, `d63d392`, `dfc599f`, and `5fd1591` models.dev snapshot commits added directly migratable pricing-table behavior for Claude latest/Fable/Sonnet 5, Claude thinking aliases, provider-specific Stealth Claude Opus 4.8, Kimi TEE/provider/latest/thinking rows, Kimi K2 Instruct variants, Kimi K2 0905 provider rates, Kimi K3 Fast API, and updated Moonshot Kimi K3 TEE cache-read pricing. TokenFlow now preserves exact provider/colon pricing keys where ccusage prices them differently from the compact display model, while keeping displayed bucket models compact. Pricing lookup also keeps provider `:thinking` suffixes as exact pricing candidates so Kimi and Claude thinking rows can resolve without changing dashboard aggregation.

The 2026-08-05 parity pass found ccusage main at `9ad3c77 chore(pricing): update LiteLLM snapshot`. Its models.dev snapshot commits added directly migratable region-qualified Claude/Kimi pricing rows and updated `moonshotai/Kimi-K2.6-TEE`; TokenFlow now resolves ccusage's `@eu` models through its normalized `-eu` pricing keys, including Claude Haiku/Sonnet/Opus regional rows and `kimi-k3@eu`, while keeping displayed bucket models normalized. The LiteLLM snapshot also changed Azure GPT-5.6 Terra/Luna base rates and added Gemini Robotics ER preview token pricing; TokenFlow now includes exact Azure GPT-5.6 provider rows and compact Gemini Robotics rows. LiteLLM metadata-only additions such as Bedrock strict-tool flags and Gemini search-context query prices were not copied because TokenFlow's local collector prices token buckets, not provider feature metadata or search query billing.

The 2026-07-10 pass also showed non-pricing drift in Kimi Code paths and `usage.record` parsing, Pi named store configuration, unified report `--sections`/`--by-agent` output, Codex fork replay filtering, JSON model breakdown reporting, statusline display text, release automation, and pricing lookup caching. The 2026-07-30 pass also found ccusage's new experimental Antigravity adapter, which scans `~/.gemini/antigravity-cli/conversations/**/*.db` or `ANTIGRAVITY_DATA_DIR` conversation databases through a new SQLite/protobuf parser. Those changes were not copied because they are adapter, parser, loader, path, reporting, performance, or release-surface changes rather than directly migratable pricing behavior for TokenFlow's local collector model.

The 2026-08-01 pass also observed dependency/workflow-only upstream drift in `.github/workflows/pullfrog.yml`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, and `rust/Cargo.toml`; those changes were not copied because they do not affect TokenFlow pricing behavior. The 2026-08-02 pass also observed docs, agent-skill, workflow, lockfile, and Rust dependency churn outside TokenFlow's pricing surface; those changes were left report-only. The 2026-08-04 pass observed `8028fd4 revert(antigravity): remove the Antigravity adapter until #1487 lands (#1569)` plus docs/schema/CLI help changes, dependency bumps, and workflow churn; only pricing-table and pricing-resolution behavior was migrated.
The 2026-08-05 pass also observed `b6128f1` dependency metadata churn in `pnpm-lock.yaml` and `pnpm-workspace.yaml`; those changes were left report-only.

## Source Adapter Matrix

| ccusage adapter | TokenFlow status | Notes |
| --- | --- | --- |
| `claude` | Supported | Claude Code project JSONL usage. Includes fast/regular split when Claude Code exposes it. |
| `codex` | Supported | Codex rollout JSONL token counts. Reads recorded `thread_settings_applied` tiers when present, then existing `CODEX_HOME/config.toml` for unclassified usage to mirror ccusage fast/priority pricing. |
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
| `antigravity` | Not applicable | ccusage reverted the experimental Antigravity adapter in `8028fd4`, so there is no current upstream adapter surface to mirror. |
| `copilot` | Deferred | ccusage reads GitHub Copilot CLI OpenTelemetry JSONL from `~/.copilot/otel/*.jsonl` or `COPILOT_OTEL_FILE_EXPORTER_PATH`. This requires users to enable OTEL file export before sessions; older sessions cannot be recovered. Treat as a separate product decision rather than a no-touch local log migration. |
| `all` | Not applicable | ccusage meta-command; TokenFlow already scans all configured local sources during `status` and `sync`. |

## Intentional Differences

| Area | TokenFlow behavior |
| --- | --- |
| Upload privacy | TokenFlow does not upload source file paths, session IDs, prompts, or responses. It uploads aggregated bucket metadata. |
| Aggregation grain | TokenFlow aggregates to UTC half-hour buckets by `agent` and `model`; ccusage reports daily/monthly/session tables locally. |
| Adapter model prefixes | TokenFlow keeps raw normalized model IDs and uses the separate `agent` field instead of ccusage display prefixes. |
| Model aliases | TokenFlow honors `CCUSAGE_MODEL_ALIASES` for ccusage-compatible private/internal model aliases and display aliases. Supported formats are JSON objects such as `{"private-alpha":"gpt-5.5"}` and delimited pairs such as `private-alpha=gpt-5.5;other=claude-sonnet-4`. If the original model already has pricing, TokenFlow keeps the alias as the displayed bucket model while pricing through the original model. |
| Codex fast pricing | TokenFlow applies Codex fast multipliers only to the fast subset of a half-hour bucket when recorded tier events distinguish standard and fast turns. |
| Recorded costs | Positive recorded costs are trusted. Hermes recorded zero cost is ignored so pricing can fall back to token counts, matching ccusage's subscription-included behavior. |
| SQLite dependency | OpenCode, Goose, Hermes, and Kilo require the `sqlite3` CLI on `PATH`. |

## Automation Policy

A daily automation monitors ccusage for adapter, parser, loader, path, and pricing drift. It should only auto-implement and publish changes that are directly migratable into TokenFlow's local collector model:

- local JSON, JSONL, or SQLite source files with stable paths;
- token field mapping that can be tested with fixtures;
- pricing aliases or model normalization rules that do not require a new user workflow.

It should not auto-ship changes that require users to enable new telemetry, grant new permissions, log in to another service, or accept a new privacy surface. Those should be recorded and left for product review.
