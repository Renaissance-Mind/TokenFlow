[![TokenFlow teaser](../assets/teaser_en.png)](https://tokenflow.renaissancemind.ai/)

**言語:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | 日本語 | [한국어](README.ko.md) | [Español](README.es.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> 実際に使っている AI Agent の token 使用量を、ローカル優先で把握するためのツール。

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[機能](#機能) - [インストール](#インストール) - [クイックスタート](#クイックスタート) - [コマンド](#コマンド) - [設定](#設定) - [開発](#開発)

TokenFlow は、複数デバイスの AI Agent 利用量を集計するためのインストール可能なローカルコレクターです。ローカルの Codex、Claude Code、Gemini CLI、OpenCode、cc-switch の使用データを読み取り、UTC 日付、Agent、モデルごとに token 数を集計し、既知モデルのコストを計算して、使用メタデータだけを TokenFlow サーバーへアップロードします。

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
- 🤖 **複数 Agent 対応** - Codex、Claude Code、Gemini CLI、OpenCode、cc-switch に対応します。
- 📊 **UTC 日次 bucket** - 日付、Agent、モデルごとに集計し、安定したダッシュボード表示に向きます。
- 💸 **コストを意識した集計** - fresh input、cached input、cache creation、output、reasoning output tokens を分けて扱います。
- 🧾 **未価格モデルの可視化** - 未知のモデルも token として集計し、`unpriced` として明示します。
- 🔁 **自動同期** - macOS `launchd` または Linux systemd user timer に 10 分間隔の同期を設定します。
- 🔑 **デバイスログインまたは API key アップロード** - ブラウザでのデバイス連携と `read_write` API token に対応します。
- 🛠️ **セルフホスト対応** - 互換性のある任意の TokenFlow server URL を指定できます。

## 対応データソース

| ソース | 読み取るローカルデータ | 備考 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` と archived session JSONL | ローカル rollout token イベントを解析します。 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | プロジェクト JSONL の使用データを解析します。 |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Gemini session JSON ファイルを解析します。 |
| OpenCode | `~/.local/share/opencode/opencode.db` | `PATH` 上に `sqlite3` が必要です。 |
| cc-switch | `~/.cc-switch/cc-switch.db` | 既定では価格表を読み取ります。`proxy_request_logs` は `CC_SWITCH_DB` を設定した場合のみ取り込みます。 |

TokenFlow は、ソースファイルパス、session ID、プロンプト、応答本文をアップロードしません。

## インストール

TokenFlow には Node.js 20 以上が必要です。

```bash
npm install -g @renaissancemind/tokenflow
```

OpenCode または cc-switch を使う場合は、`sqlite3` が利用できることを確認してください。

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
| `sync` | ローカル使用量を解析し、UTC 日次 bucket を作成し、アップロードして `lastSyncAt` を更新します。 |
| `status` | ローカル設定、source の有無、bucket 数、認証状態、未価格モデルを表示します。 |
| `update` | グローバル package を再インストールし、自動同期スケジューラーを更新します。 |
| `logout` | ローカルの upload token を削除し、非シークレット設定は残します。 |

## 価格モデル

TokenFlow はアップロード前にローカルでコストを計算します。

- 組み込み価格表は既知の Codex、Claude、Gemini モデル ID をカバーします。
- cc-switch データベースが存在する場合、cc-switch `model_pricing` でローカル価格表を拡張または上書きできます。
- 未知のモデルも集計され、`pricing_status: "unpriced"` としてアップロードされます。
- 未価格 bucket のコストは `$0.000000` として記録されるため、token 合計は正確なまま、コストの欠落も見える状態になります。
- Codex と Gemini では cached input は reported input の一部として扱われ、コスト計算前に分離されるため、二重計上を避けられます。

## 設定

環境変数による上書き:

| 変数 | 用途 |
| --- | --- |
| `TOKENFLOW_HOME` | ローカル状態ディレクトリ。既定は `~/.tokenflow`。 |
| `TOKENFLOW_SERVER_URL` | 既定のサーバー URL。 |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | launchd/systemd に書き込むコマンド。既定は `npx --yes @renaissancemind/tokenflow@latest sync --auto`。 |
| `TOKENFLOW_UPDATE_SOURCE` | `tokenflow update` で `--source` を省略した場合に使う package/source。 |
| `CODEX_HOME` | Codex 設定ホーム。既定は `~/.codex`。 |
| `CLAUDE_HOME` | Claude 設定ホーム。既定は `~/.claude`。 |
| `GEMINI_HOME` | Gemini 設定ホーム。既定は `~/.gemini`。 |
| `OPENCODE_DB` | 明示的な OpenCode SQLite データベースパス。 |
| `OPENCODE_HOME` | OpenCode データホーム。既定は `~/.local/share/opencode`。 |
| `XDG_DATA_HOME` | `OPENCODE_DB` と `OPENCODE_HOME` が未設定の場合に OpenCode データを解決するために使います。 |
| `CC_SWITCH_DB` | 明示的な cc-switch SQLite パス。`proxy_request_logs` の取り込みと価格表読み取りを有効にします。 |

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

- OpenCode と cc-switch のデータベース読み取りには `sqlite3` CLI が必要です。
- 自動同期のインストールは macOS と Linux のみです。他のプラットフォームでは `tokenflow sync` を手動実行するか、独自のスケジューラーに組み込んでください。
- cc-switch request logs は `CC_SWITCH_DB` を明示した場合のみ取り込みます。これは Codex、Claude、Gemini のネイティブログとの二重計上を避けるためです。
- 未知のモデル ID のコストは、価格ルールが追加されるまで `unpriced` として扱われます。

## ドキュメント

この README は CLI の主要なユーザードキュメントです。実装の詳細は、`test/` の焦点を絞ったテストと `src/` の TypeScript モジュールから確認できます。

## コントリビューション

Issue と pull request を歓迎します。parser、pricing、scheduler、command の挙動を変更する場合は、焦点を絞ったテストを追加してください。

## ライセンス

このリポジトリには現在 license ファイルが含まれていません。
