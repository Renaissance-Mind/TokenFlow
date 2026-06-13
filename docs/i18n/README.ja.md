[![TokenFlow teaser](../assets/teaser_en.png)](https://tokenflow.renaissancemind.ai/)

**言語:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | 日本語 | [한국어](README.ko.md) | [Español](README.es.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> 実際に使っている AI Agent の token 使用量を、ローカル優先で把握するためのツール。

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[機能](#機能) - [インストール](#インストール) - [クイックスタート](#クイックスタート) - [コマンド](#コマンド) - [設定](#設定) - [開発](#開発)

TokenFlow は、複数デバイスの AI Agent 利用量を集計するためのインストール可能なローカルコレクターです。ローカルの Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi の使用データを読み取り、UTC 30 分 bucket、Agent、モデルごとに token 数を集計し、既知モデルのコストを計算して、使用メタデータだけを TokenFlow サーバーへアップロードします。

プロンプトと応答本文はあなたのマシンに残ります。アップロードされるのは、カウント、モデル名、bucket のタイムスタンプ、課金ステータス、任意のデバイスメタデータだけです。

## プレビュー

```bash
$ tokenflow status
TokenFlow status
Config: /Users/alice/.tokenflow/config.json
Server: https://tokenflow.renaissancemind.ai
Device: dev_...
Token: set (device)
Remote: linked
Local events: 1842
Local buckets: 37
Source codex: found (219 files) /Users/alice/.codex/sessions
Source claude: found (64 files) /Users/alice/.claude/projects
Source gemini: missing (0 files) /Users/alice/.gemini/tmp
Source opencode: found (1 files) /Users/alice/.local/share/opencode/opencode.db
Home: /Users/alice/.tokenflow
```

## 機能

- 🔐 **ローカル優先の収集** - Agent ログをローカルで読み取り、メタデータだけをアップロードします。
- 🤖 **複数 Agent 対応** - Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi に対応します。
- 📊 **UTC 30 分 bucket** - ローカルの使用詳細を保ちながら、dashboard では日次集計もできます。
- 💸 **コストを意識した集計** - fresh input、cached input、cache creation、output、reasoning output tokens を分けて扱います。
- 🧾 **未価格モデルの可視化** - 未知のモデルも token として集計し、`unpriced` として明示します。
- 🔁 **自動同期** - macOS `launchd` または Linux systemd user timer に 10 分間隔の同期を設定します。
- 🔑 **デバイスログインまたは API key アップロード** - ブラウザでのデバイス連携と `read_write` API token に対応します。
- 🛠️ **セルフホスト対応** - 互換性のある任意の TokenFlow server URL を指定できます。

## 対応データソース

| ソース | 読み取るローカルデータ | 備考 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` and archived session JSONL | Parses local rollout token events. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Parses project JSONL usage data. |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Parses Gemini session JSON files. |
| OpenCode | `~/.local/share/opencode/opencode.db` | Requires `sqlite3` on `PATH`. |
| Kimi CLI | `~/.kimi/sessions/*/*/wire.jsonl` | Reads `StatusUpdate.token_usage` rows and `~/.kimi/config.json` model metadata. |
| Qwen Code | `~/.qwen/projects/*/chats/*.jsonl` | Reads assistant `usageMetadata` rows. |
| Amp | `~/.local/share/amp/threads/*.json` | Reads `usageLedger.events[]` or assistant `messages[].usage`. |
| Codebuff | `~/.config/manicode*/projects/**/chat-messages.json` | Reads assistant metadata usage and run-state provider usage. |
| Droid | `~/.factory/sessions/**/*.settings.json` | Reads session token snapshots and keeps the latest snapshot per session. |
| Goose | `~/.local/share/goose/sessions/sessions.db`, macOS Application Support, or Block Goose data | Requires `sqlite3` on `PATH`. |
| Hermes | `~/.hermes/state.db` | Requires `sqlite3` on `PATH`. |
| Kilo | `~/.local/share/kilo/kilo.db` | Requires `sqlite3` on `PATH`. |
| OpenClaw | `~/.openclaw`, `~/.clawdbot`, `~/.moltbot`, and `~/.moldbot` JSONL sessions | Tracks model-change rows for following assistant usage. |
| Pi | `~/.pi/agent/sessions/**/*.jsonl` | Reads assistant message usage rows. |

TokenFlow は、ソースファイルパス、session ID、プロンプト、応答本文をアップロードしません。

## インストール

TokenFlow には Node.js 20 以上が必要です。

```bash
npm install -g @renaissancemind/tokenflow
```

OpenCode、Goose、Hermes、Kilo を使う場合は、`sqlite3` が利用できることを確認してください。

```bash
sqlite3 --version
```

npm 公開前にローカル checkout からインストールする場合:

```bash
npm install
npm install -g .
```

`npm install -g .` は package の `prepare` script を実行するため、TypeScript CLI をビルドしてから `dist/cli.js` をグローバルコマンドとしてリンクします。

## クイックスタート

### 1. このマシンを連携する

```bash
tokenflow login
```

既定では、`login` は `https://tokenflow.renaissancemind.ai` を使用します。verification URL と user code を表示し、可能であればブラウザを開き、承認された device token を `~/.tokenflow/config.json` に保存します。

セルフホストしたサーバーを使う場合:

```bash
tokenflow login --server-url http://127.0.0.1:8787
```

### 2. スキャン対象を確認する

```bash
tokenflow status
```

`status` は、ローカル source パス、解析済み event 数、bucket 数、未価格 bucket 数、設定ファイルの場所、token 設定時のリモート認証状態を表示します。

### 3. 使用量を同期する

```bash
tokenflow sync
```

`sync` はローカルログをスキャンし、使用量を集計し、bucket を冪等にアップロードし、同期 heartbeat を記録して、解析済み events とアップロード済み buckets を報告します。

### 4. 自動同期をインストールする

```bash
tokenflow init
```

`init` は `~/.tokenflow/config.json` を書き込み、macOS または Linux で 10 分ごとの自動同期を設定し、token がない場合はブラウザのデバイス連携フローを開始します。

## API Token モード

ブラウザでのデバイス連携は個人マシンに便利です。サーバー、CI に近いマシン、スクリプト化されたインストールでは、TokenFlow server dashboard で `read_write` API key を作成できます。

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
```

使用量をアップロードできるのは `read_write` key だけです。`read_only` key は dashboard、API 読み取り、公開 heatmap embed 用です。CLI は `init` と `login` の時点で read-only key を拒否します。

## コマンド

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
tokenflow sync
tokenflow status
tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| コマンド | 内容 |
| --- | --- |
| `init` | 設定を書き込み、自動同期をインストールし、必要に応じて login を開始します。 |
| `login` | ブラウザ承認済み device token を連携するか、検証済み upload API token を保存します。 |
| `sync` | ローカル使用量を解析し、UTC 30 分 bucket を作成し、アップロードして `lastSyncAt` を更新します。 |
| `status` | ローカル設定、source の有無、bucket 数、認証状態、未価格モデルを表示します。 |
| `update` | グローバル package を再インストールし、自動同期スケジューラーを更新します。 |
| `logout` | ローカルの upload token を削除し、非シークレット設定は残します。 |

## 価格モデル

TokenFlow はアップロード前にローカルでコストを計算します。

- Built-in pricing covers known Codex, Claude, Gemini, OpenCode, and cc-switch-inspired third-party coding/provider model IDs including DeepSeek, Kimi K2, MiniMax, GLM, Qwen, Doubao, StepFun, MiMo, Grok, Mistral, and Cohere.
- Unknown models are still counted and uploaded with `pricing_status: "unpriced"`.
- Unpriced buckets record cost as `$0.000000` so token totals remain accurate and cost gaps stay visible.
- Cost calculation follows ccusage-style token accounting: fresh input, output, cache read, cache creation, optional 200k+ pricing tiers, and 1-hour cache creation at 2x input price when a source reports cache creation duration.
- For Codex and Gemini, cached input can be included in reported input and is separated before cost calculation to avoid double-counting.
- Kimi CLI keeps `kimi-for-coding` as the displayed model, while pricing resolves to K2.5 before `2026-04-20T15:28:10.072Z` and K2.6 after that cutoff, matching ccusage's documented mapping.

## 設定

環境変数による上書き:

| Variable | Purpose |
| --- | --- |
| `TOKENFLOW_HOME` | Local state directory. Defaults to `~/.tokenflow`. |
| `TOKENFLOW_SERVER_URL` | Default server URL. |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | Command written into launchd/systemd. Defaults to `tokenflow sync --auto`. |
| `TOKENFLOW_SYNC_MAX_BUCKETS` | Maximum changed buckets uploaded per sync. Defaults to `60` to keep first-time backfills Cloudflare-friendly. |
| `TOKENFLOW_REQUEST_TIMEOUT_MS` | HTTP request timeout for TokenFlow server calls. Defaults to `30000`. |
| `TOKENFLOW_UPDATE_SOURCE` | Package/source used by `tokenflow update` when `--source` is omitted. |
| `CODEX_HOME` | Codex config home. Defaults to `~/.codex`. |
| `CLAUDE_HOME` | Claude config home. Defaults to `~/.claude`. |
| `GEMINI_HOME` | Gemini config home. Defaults to `~/.gemini`. |
| `OPENCODE_DB` | Explicit OpenCode SQLite database path. |
| `OPENCODE_HOME` | OpenCode data home. Defaults to `~/.local/share/opencode`. |
| `KIMI_DATA_DIR` | Kimi data root, or comma-separated roots. Defaults to `~/.kimi`. |
| `QWEN_DATA_DIR` | Qwen data root, or comma-separated roots. Defaults to `~/.qwen`. |
| `AMP_DATA_DIR` | Amp data root, or comma-separated roots. Defaults to `~/.local/share/amp`. |
| `CODEBUFF_DATA_DIR` | Codebuff/Manicode data root or `projects` root, comma-separated. Defaults to `~/.config/manicode`, `~/.config/manicode-dev`, and `~/.config/manicode-staging`. |
| `DROID_SESSIONS_DIR` | Droid sessions root, or comma-separated roots. Defaults to `~/.factory/sessions`. |
| `GOOSE_PATH_ROOT` | Goose root used to resolve `data/sessions/sessions.db`. |
| `HERMES_HOME` | Hermes home, or comma-separated homes. Defaults to `~/.hermes`. |
| `KILO_DATA_DIR` | Kilo data root, or comma-separated roots. Defaults to `~/.local/share/kilo`. |
| `OPENCLAW_DIR` | OpenClaw-compatible roots, comma-separated. Defaults to `~/.openclaw`, `~/.clawdbot`, `~/.moltbot`, and `~/.moldbot`. |
| `PI_AGENT_DIR` | Pi agent sessions root, or comma-separated roots. Defaults to `~/.pi/agent/sessions`. |
| `XDG_DATA_HOME` | Used to resolve OpenCode data when `OPENCODE_DB` and `OPENCODE_HOME` are unset. |

### 自動同期でローカル checkout を使う

npm 公開前に、この checkout をスケジューラーで固定して実行できます。

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

公開後は、既定のスケジューラーコマンドで npm を使えます。

```bash
npx --yes @renaissancemind/tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

## 開発

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

ソースは小さな TypeScript CLI です。

- `src/cli.ts` - コマンドルーティングとユーザー向けの挙動。
- `src/file-scan.ts` - ローカル Agent の検出と解析エントリーポイント。
- `src/sources/*` - source ごとの parser。
- `src/usage-buckets.ts` - UTC bucket 集計。
- `src/pricing.ts` - 価格解決とコスト計算。
- `src/api.ts` - デバイスフロー、token 検証、ingest 呼び出し。
- `src/scheduler.ts` - macOS launchd と Linux systemd timer のインストール。

## 制限

- OpenCode, Goose, Hermes, and Kilo database reads require the `sqlite3` CLI.
- Qoder is not currently treated as a token source because ccusage has no Qoder adapter and public Qoder APIs expose credits/usage events rather than local input/output/cache token logs.
- 自動同期のインストールは macOS と Linux のみです。他のプラットフォームでは `tokenflow sync` を手動実行するか、独自のスケジューラーに組み込んでください。
- 未知のモデル ID のコストは、価格ルールが追加されるまで `unpriced` として扱われます。

## ドキュメント

この README は CLI の主要なユーザードキュメントです。実装の詳細は、`test/` の焦点を絞ったテストと `src/` の TypeScript モジュールから確認できます。

## コントリビューション

Issue と pull request を歓迎します。parser、pricing、scheduler、command の挙動を変更する場合は、焦点を絞ったテストを追加してください。

## ライセンス

このリポジトリには現在 license ファイルが含まれていません。
