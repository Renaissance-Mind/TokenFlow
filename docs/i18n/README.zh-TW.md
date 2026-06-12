[![TokenFlow teaser](../assets/teaser_zh.png)](https://tokenflow.renaissancemind.ai/)

**語言:** [English](../../README.md) | [简体中文](README.zh-CN.md) | 繁體中文 | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> 面向真實 AI Agent 工作流的本地優先 token 統計工具。

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[功能](#功能) - [安裝](#安裝) - [快速開始](#快速開始) - [命令](#命令) - [設定](#設定) - [開發](#開發)

TokenFlow 是一個可安裝的本地採集器，用於統計多裝置 AI Agent 的 token 使用量。它會掃描本地 Codex、Claude Code、Gemini CLI、OpenCode 和 cc-switch 使用資料，按 UTC 日期、Agent 和模型彙總 token 數量，計算已知模型成本，並只把使用元資料上傳到 TokenFlow 伺服器。

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
- 🤖 **多 Agent 支援** - 支援 Codex、Claude Code、Gemini CLI、OpenCode 和 cc-switch。
- 📊 **UTC 日級 bucket** - 按日期、Agent、模型彙總，方便穩定展示和同步。
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
| cc-switch | `~/.cc-switch/cc-switch.db` | 預設讀取計價表；只有設定 `CC_SWITCH_DB` 時才匯入 `proxy_request_logs`。 |

TokenFlow 不會上傳來源檔案路徑、session ID、提示詞或回覆內容。

## 安裝

TokenFlow 需要 Node.js 20 或更高版本。

```bash
npm install -g @renaissancemind/tokenflow
```

如果需要 OpenCode 或 cc-switch 支援，請確認 `sqlite3` 可用：

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
| `sync` | 解析本地使用量，建立 UTC 日級 bucket，上傳並更新 `lastSyncAt`。 |
| `status` | 列印本地設定、source 可用性、bucket 數量、認證狀態和未計價模型。 |
| `update` | 重新安裝全域套件並刷新自動同步排程器。 |
| `logout` | 移除本地上傳 token，同時保留非密鑰設定。 |

## 計價模型

TokenFlow 會在上傳前本地計算成本。

- 內建計價覆蓋已知 Codex、Claude 和 Gemini 模型 ID。
- 當 cc-switch 資料庫存在時，cc-switch `model_pricing` 可以擴充或覆蓋本地計價。
- 未知模型仍會被統計並以 `pricing_status: "unpriced"` 上傳。
- 未計價 bucket 的成本記錄為 `$0.000000`，這樣 token 總量保持準確，成本缺口也保持可見。
- 對 Codex 和 Gemini，cached input 被視為 reported input 的一部分，並會在成本計算前拆分出來，避免重複計費。

## 設定

環境變數覆蓋項：

| 變數 | 用途 |
| --- | --- |
| `TOKENFLOW_HOME` | 本地狀態目錄。預設 `~/.tokenflow`。 |
| `TOKENFLOW_SERVER_URL` | 預設伺服器 URL。 |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | 寫入 launchd/systemd 的命令。預設 `npx --yes @renaissancemind/tokenflow@latest sync --auto`。 |
| `TOKENFLOW_UPDATE_SOURCE` | `tokenflow update` 未傳 `--source` 時使用的 package/source。 |
| `CODEX_HOME` | Codex 設定目錄。預設 `~/.codex`。 |
| `CLAUDE_HOME` | Claude 設定目錄。預設 `~/.claude`。 |
| `GEMINI_HOME` | Gemini 設定目錄。預設 `~/.gemini`。 |
| `OPENCODE_DB` | 明確指定 OpenCode SQLite 資料庫路徑。 |
| `OPENCODE_HOME` | OpenCode 資料目錄。預設 `~/.local/share/opencode`。 |
| `XDG_DATA_HOME` | 未設定 `OPENCODE_DB` 和 `OPENCODE_HOME` 時用於解析 OpenCode 資料目錄。 |
| `CC_SWITCH_DB` | 明確指定 cc-switch SQLite 路徑。啟用 `proxy_request_logs` 匯入和計價讀取。 |

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

- OpenCode 和 cc-switch 資料庫讀取需要 `sqlite3` CLI。
- 自動同步只在 macOS 和 Linux 上安裝；其他平台可以手動執行 `tokenflow sync` 或自行接入排程器。
- 除非明確設定 `CC_SWITCH_DB`，否則不會匯入 cc-switch request logs，以避免和原生 Codex、Claude、Gemini 日誌重複計數。
- 未知模型 ID 的成本會標記為 `unpriced`，直到存在對應計價規則。

## 文件

這個 README 是 CLI 的主要使用者文件。實作細節可以從 `test/` 中的聚焦測試和 `src/` 中的 TypeScript 模組開始閱讀。

## 貢獻

歡迎提交 issue 和 pull request。涉及 parser、pricing、scheduler 或 command 行為的修改，請附帶聚焦測試。

## 授權

目前倉庫尚未包含 license 檔案。
