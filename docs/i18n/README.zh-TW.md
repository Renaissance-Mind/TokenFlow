[![TokenFlow teaser](../assets/teaser_zh.png)](https://tokenflow.renaissancemind.ai/)

**語言:** [English](../../README.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> 面向真實 AI Agent 工作流的本地優先 token 統計工具。

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[功能](#功能) - [安裝](#安裝) - [快速開始](#快速開始) - [命令](#命令) - [設定](#設定) - [開發](#開發)

TokenFlow 是一個可安裝的本地採集器，用於統計多裝置 AI Agent 的 token 使用量。它會掃描本地 Codex、Claude Code、Gemini CLI、OpenCode、Kimi CLI、Qwen Code、Amp、Codebuff、Droid、Goose、Hermes、Kilo、OpenClaw 和 Pi 使用資料，按 UTC 半小時 bucket、Agent 和模型彙總 token 數量，計算已知模型成本，並只把使用元資料上傳到 TokenFlow 伺服器。

提示詞和回覆內容會留在你的機器上。上傳資料只包含計數、模型名稱、bucket 時間戳、計價狀態，以及可選的裝置元資料。

## 預覽

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

## 功能

- 🔐 **本地優先採集** - 在本機讀取 Agent 日誌，只上傳元資料。
- 🤖 **多 Agent 支援** - 支援 Codex、Claude Code、Gemini CLI、OpenCode、Kimi CLI、Qwen Code、Amp、Codebuff、Droid、Goose、Hermes、Kilo、OpenClaw 和 Pi。
- 📊 **UTC 半小時 bucket** - 保留本地使用細節，同時 dashboard 仍可按天彙總。
- 💸 **成本感知統計** - 區分 fresh input、cached input、cache creation、output 和 reasoning output tokens。
- 🧾 **未計價模型可見** - 未知模型仍然計入 token，並標記為 `unpriced`。
- 🔁 **自動同步** - 在 macOS `launchd` 或 Linux systemd user timer 中安裝 10 分鐘同步任務。
- 🔑 **裝置登入或 API key 上傳** - 支援瀏覽器裝置授權和 `read_write` API token。
- 🛠️ **適合自託管** - 可以指向任意相容的 TokenFlow server URL。

## 支援的資料來源

| 來源 | 讀取的本地資料 | 說明 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` 和 archived session JSONL | 解析本地 rollout token 事件。 |
| Claude Code | `~/.claude/projects/**/*.jsonl` | 解析專案 JSONL 使用資料。 |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | 解析 Gemini session JSON 檔案。 |
| OpenCode | `~/.local/share/opencode/opencode.db` | 需要 `PATH` 中存在 `sqlite3`。 |
| Kimi CLI | `~/.kimi/sessions/*/*/wire.jsonl` | 讀取 `StatusUpdate.token_usage` 行和 `~/.kimi/config.json` 模型元資料。 |
| Qwen Code | `~/.qwen/projects/*/chats/*.jsonl` | 讀取 assistant `usageMetadata` 行。 |
| Amp | `~/.local/share/amp/threads/*.json` | 讀取 `usageLedger.events[]` 或 assistant `messages[].usage`。 |
| Codebuff | `~/.config/manicode*/projects/**/chat-messages.json` | 讀取 assistant metadata usage 和 run-state provider usage。 |
| Droid | `~/.factory/sessions/**/*.settings.json` | 讀取 session token snapshot，並保留每個 session 的最新 snapshot。 |
| Goose | `~/.local/share/goose/sessions/sessions.db`、macOS Application Support 或 Block Goose 資料 | 需要 `PATH` 中存在 `sqlite3`。 |
| Hermes | `~/.hermes/state.db` | 需要 `PATH` 中存在 `sqlite3`。 |
| Kilo | `~/.local/share/kilo/kilo.db` | 需要 `PATH` 中存在 `sqlite3`。 |
| OpenClaw | `~/.openclaw`、`~/.clawdbot`、`~/.moltbot` 和 `~/.moldbot` JSONL sessions | 追蹤 model-change 行並關聯後續 assistant usage。 |
| Pi | `~/.pi/agent/sessions/**/*.jsonl` | 讀取 assistant message usage 行。 |

TokenFlow 不會上傳來源檔案路徑、session ID、提示詞或回覆內容。

## 安裝

TokenFlow 需要 Node.js 20 或更高版本。

```bash
npm install -g @renaissancemind/tokenflow
```

如果需要 OpenCode、Goose、Hermes 或 Kilo 支援，請確認 `sqlite3` 可用：

```bash
sqlite3 --version
```

在 npm 發布前從本地 checkout 安裝：

```bash
npm install
npm install -g .
```

`npm install -g .` 會執行 package 的 `prepare` script，因此會先編譯 TypeScript CLI，再把 `dist/cli.js` 連結為全域命令。

## 快速開始

### 1. 關聯這台機器

```bash
tokenflow login
```

預設情況下，`login` 使用 `https://tokenflow.renaissancemind.ai`。它會列印 verification URL 和 user code，在可能時開啟瀏覽器，並把授權後的 device token 儲存到 `~/.tokenflow/config.json`。

使用自託管伺服器：

```bash
tokenflow login --server-url http://127.0.0.1:8787
```

### 2. 查看會掃描哪些資料

```bash
tokenflow status
```

`status` 會顯示本地 source 路徑、解析到的 event 數量、bucket 數量、未計價 bucket 數量、設定檔位置，以及已設定 token 時的遠端認證狀態。

### 3. 同步使用量

```bash
tokenflow sync
```

`sync` 會掃描本地日誌、彙總使用量、冪等上傳 bucket、記錄同步心跳，並回報解析到的 events 和上傳的 buckets。

### 4. 安裝自動同步

```bash
tokenflow init
```

`init` 會寫入 `~/.tokenflow/config.json`，在 macOS 或 Linux 上安裝每 10 分鐘執行一次的自動同步任務，然後在沒有 token 時啟動瀏覽器裝置授權流程。

## API Token 模式

瀏覽器裝置授權適合個人機器。對於伺服器、類 CI 機器或腳本化安裝，可以在 TokenFlow server dashboard 中建立 `read_write` API key：

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
```

只有 `read_write` key 可以上傳使用量。`read_only` key 用於 dashboard、API 讀取和公開 heatmap embed；CLI 會在 `init` 和 `login` 階段拒絕 read-only key。

## 命令

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
tokenflow sync
tokenflow status
tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| 命令 | 作用 |
| --- | --- |
| `init` | 寫入設定、安裝自動同步，並可選啟動登入。 |
| `login` | 關聯瀏覽器授權的 device token，或儲存已驗證的 upload API token。 |
| `sync` | 解析本地使用量，建立 UTC 半小時 bucket，上傳並更新 `lastSyncAt`。 |
| `status` | 列印本地設定、source 可用性、bucket 數量、認證狀態和未計價模型。 |
| `update` | 重新安裝全域套件並刷新自動同步排程器。 |
| `logout` | 移除本地上傳 token，同時保留非密鑰設定。 |

## 計價模型

TokenFlow 會在上傳前本地計算成本。

- 內建計價覆蓋已知 Codex、Claude、Gemini、OpenCode，以及參考 cc-switch 的第三方 coding/provider 模型 ID，包括 DeepSeek、Kimi K2、MiniMax、GLM、Qwen、Doubao、StepFun、MiMo、Grok、Mistral 和 Cohere。
- 未知模型仍會被統計並以 `pricing_status: "unpriced"` 上傳。
- 未計價 bucket 的成本記錄為 `$0.000000`，這樣 token 總量保持準確，成本缺口也保持可見。
- 成本計算遵循 ccusage 風格的 token 統計：fresh input、output、cache read、cache creation、可選 200k+ 計價層，以及來源上報 cache creation duration 時的 1 小時 cache creation 2x input 價格。
- 對 Codex 和 Gemini，cached input 可能包含在 reported input 中，並會在成本計算前拆分出來，避免重複計費。
- Kimi CLI 展示模型保持為 `kimi-for-coding`；計價會在 `2026-04-20T15:28:10.072Z` 前解析到 K2.5，之後解析到 K2.6，與 ccusage 的映射一致。

## 設定

環境變數覆蓋項：

| 變數 | 用途 |
| --- | --- |
| `TOKENFLOW_HOME` | 本地狀態目錄。預設 `~/.tokenflow`。 |
| `TOKENFLOW_SERVER_URL` | 預設伺服器 URL。 |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | 寫入 launchd/systemd 的命令。預設 `tokenflow sync --auto`。 |
| `TOKENFLOW_SYNC_MAX_BUCKETS` | 每次 sync 上傳的最大變更 bucket 數。預設 `60`，讓首次回填更適合 Cloudflare。 |
| `TOKENFLOW_REQUEST_TIMEOUT_MS` | TokenFlow server HTTP 請求逾時。預設 `30000`。 |
| `TOKENFLOW_UPDATE_SOURCE` | `tokenflow update` 未傳 `--source` 時使用的 package/source。 |
| `CODEX_HOME` | Codex 設定目錄。預設 `~/.codex`。 |
| `CLAUDE_HOME` | Claude 設定目錄。預設 `~/.claude`。 |
| `GEMINI_HOME` | Gemini 設定目錄。預設 `~/.gemini`。 |
| `OPENCODE_DB` | 明確指定 OpenCode SQLite 資料庫路徑。 |
| `OPENCODE_HOME` | OpenCode 資料目錄。預設 `~/.local/share/opencode`。 |
| `KIMI_DATA_DIR` | Kimi 資料根目錄，或逗號分隔的多個根目錄。預設 `~/.kimi`。 |
| `QWEN_DATA_DIR` | Qwen 資料根目錄，或逗號分隔的多個根目錄。預設 `~/.qwen`。 |
| `AMP_DATA_DIR` | Amp 資料根目錄，或逗號分隔的多個根目錄。預設 `~/.local/share/amp`。 |
| `CODEBUFF_DATA_DIR` | Codebuff/Manicode 資料根目錄或 `projects` 根目錄，可用逗號分隔。預設 `~/.config/manicode`、`~/.config/manicode-dev` 和 `~/.config/manicode-staging`。 |
| `DROID_SESSIONS_DIR` | Droid sessions 根目錄，或逗號分隔的多個根目錄。預設 `~/.factory/sessions`。 |
| `GOOSE_PATH_ROOT` | Goose root，用於解析 `data/sessions/sessions.db`。 |
| `HERMES_HOME` | Hermes home，或逗號分隔的多個 home。預設 `~/.hermes`。 |
| `KILO_DATA_DIR` | Kilo 資料根目錄，或逗號分隔的多個根目錄。預設 `~/.local/share/kilo`。 |
| `OPENCLAW_DIR` | OpenClaw 相容根目錄，可用逗號分隔。預設 `~/.openclaw`、`~/.clawdbot`、`~/.moltbot` 和 `~/.moldbot`。 |
| `PI_AGENT_DIR` | Pi agent sessions 根目錄，或逗號分隔的多個根目錄。預設 `~/.pi/agent/sessions`。 |
| `XDG_DATA_HOME` | 未設定 `OPENCODE_DB` 和 `OPENCODE_HOME` 時用於解析 OpenCode 資料目錄。 |

### 自動同步使用本地 checkout

npm 發布前，可以讓排程器固定執行這個 checkout：

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

發布後，預設排程命令可以直接使用 npm：

```bash
npx --yes @renaissancemind/tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

## 開發

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

原始碼是一個小型 TypeScript CLI：

- `src/cli.ts` - 命令路由和面向使用者的行為。
- `src/file-scan.ts` - 本地 Agent 發現和解析入口。
- `src/sources/*` - 各 source 專用 parser。
- `src/usage-buckets.ts` - UTC bucket 彙總。
- `src/pricing.ts` - 計價解析和成本計算。
- `src/api.ts` - 裝置授權、token 驗證和 ingest 呼叫。
- `src/scheduler.ts` - macOS launchd 和 Linux systemd timer 安裝。

## 限制

- OpenCode、Goose、Hermes 和 Kilo 資料庫讀取需要 `sqlite3` CLI。
- Qoder 目前不會作為 token source 處理，因為 ccusage 沒有 Qoder adapter，公開 Qoder API 暴露的是 credits/usage events，而不是本地 input/output/cache token 日誌。
- 自動同步只在 macOS 和 Linux 上安裝；其他平台可以手動執行 `tokenflow sync` 或自行接入排程器。
- 未知模型 ID 的成本會標記為 `unpriced`，直到存在對應計價規則。

## 文件

這個 README 是 CLI 的主要使用者文件。實作細節可以從 `test/` 中的聚焦測試和 `src/` 中的 TypeScript 模組開始閱讀。

## 貢獻

歡迎提交 issue 和 pull request。涉及 parser、pricing、scheduler 或 command 行為的修改，請附帶聚焦測試。

## 授權

目前倉庫尚未包含 license 檔案。
