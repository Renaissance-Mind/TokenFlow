[![TokenFlow teaser](../assets/teaser_en.png)](https://tokenflow.renaissancemind.ai/)

**언어:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | 한국어 | [Español](README.es.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> 실제로 사용하는 AI Agent의 token 사용량을 로컬 우선 방식으로 집계합니다.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[기능](#기능) - [설치](#설치) - [빠른 시작](#빠른-시작) - [명령어](#명령어) - [설정](#설정) - [개발](#개발)

TokenFlow는 여러 기기에서 사용하는 AI Agent의 사용량을 집계하는 설치형 로컬 collector입니다. 로컬의 Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi 사용 데이터를 스캔하고, UTC 30분 bucket, Agent, 모델별로 token 수를 집계하며, 알려진 모델의 비용을 계산한 뒤 사용 메타데이터만 TokenFlow 서버로 업로드합니다.

프롬프트와 응답 본문은 사용자의 머신에 남습니다. 업로드되는 payload에는 count, 모델명, bucket timestamp, pricing status, 선택적인 device metadata만 포함됩니다.

## 미리보기

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

## 기능

- 🔐 **로컬 우선 수집** - Agent 로그를 로컬에서 읽고 메타데이터만 업로드합니다.
- 🤖 **다중 Agent 지원** - Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi.
- 📊 **UTC 30분 bucket** - 로컬 사용 상세를 유지하면서 dashboard에서는 일별 요약도 가능합니다.
- 💸 **비용 인식 집계** - fresh input, cached input, cache creation, output, reasoning output tokens를 분리합니다.
- 🧾 **미가격 모델 가시화** - 알 수 없는 모델도 token으로 집계하고 `unpriced`로 표시합니다.
- 🔁 **자동 동기화** - macOS `launchd` 또는 Linux systemd user timer에 10분 간격 동기화를 설치합니다.
- 🔑 **기기 로그인 또는 API key 업로드** - 브라우저 기기 승인과 `read_write` API token을 지원합니다.
- 🛠️ **셀프 호스팅 친화적** - 호환되는 TokenFlow server URL을 직접 지정할 수 있습니다.

## 지원 소스

| 소스 | 읽는 로컬 데이터 | 참고 |
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

TokenFlow는 source file path, session ID, prompt, response 본문을 업로드하지 않습니다.

## 설치

TokenFlow는 Node.js 20 이상이 필요합니다.

```bash
npm install -g @renaissancemind/tokenflow
```

OpenCode, Goose, Hermes 또는 Kilo 지원이 필요하다면 `sqlite3`를 사용할 수 있는지 확인하세요.

```bash
sqlite3 --version
```

npm 배포 전에 로컬 checkout에서 설치하려면:

```bash
npm install
npm install -g .
```

`npm install -g .`는 package의 `prepare` script를 실행하므로 TypeScript CLI를 먼저 컴파일한 뒤 `dist/cli.js`를 전역 명령으로 연결합니다.

## 빠른 시작

### 1. 이 머신 연결

```bash
tokenflow login
```

기본적으로 `login`은 `https://tokenflow.renaissancemind.ai`를 사용합니다. verification URL과 user code를 출력하고, 가능하면 브라우저를 열며, 승인된 device token을 `~/.tokenflow/config.json`에 저장합니다.

셀프 호스팅 서버를 사용하려면:

```bash
tokenflow login --server-url http://127.0.0.1:8787
```

### 2. 스캔 대상을 확인

```bash
tokenflow status
```

`status`는 로컬 source path, 파싱된 event 수, bucket 수, unpriced bucket 수, config 위치, token이 설정된 경우 remote auth 상태를 보여줍니다.

### 3. 사용량 동기화

```bash
tokenflow sync
```

`sync`는 로컬 로그를 스캔하고, 사용량을 집계하고, bucket을 멱등적으로 업로드하고, sync heartbeat를 기록한 뒤 파싱된 events와 업로드된 buckets를 보고합니다.

### 4. 자동 동기화 설치

```bash
tokenflow init
```

`init`은 `~/.tokenflow/config.json`을 작성하고, macOS 또는 Linux에서 10분마다 실행되는 자동 동기화를 설치한 뒤, token이 없으면 브라우저 기기 승인 flow를 시작합니다.

## API Token 모드

브라우저 기기 승인은 개인 머신에 편리합니다. 서버, CI 성격의 머신, 스크립트 설치에는 TokenFlow server dashboard에서 `read_write` API key를 만들어 사용할 수 있습니다.

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
```

사용량 업로드에는 `read_write` key만 사용할 수 있습니다. `read_only` key는 dashboard, API read, public heatmap embed용입니다. CLI는 `init`과 `login` 단계에서 read-only key를 거부합니다.

## 명령어

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
tokenflow sync
tokenflow status
tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| 명령어 | 설명 |
| --- | --- |
| `init` | config를 작성하고 자동 동기화를 설치하며, 필요하면 login을 시작합니다. |
| `login` | 브라우저 승인 device token을 연결하거나 검증된 upload API token을 저장합니다. |
| `sync` | 로컬 사용량을 파싱하고 UTC 30분 bucket을 만들고 업로드한 뒤 `lastSyncAt`을 갱신합니다. |
| `status` | 로컬 config, source 사용 가능 여부, bucket 수, auth 상태, unpriced models를 출력합니다. |
| `update` | 전역 package를 다시 설치하고 자동 동기화 scheduler를 갱신합니다. |
| `logout` | 로컬 upload token을 제거하고 non-secret config는 유지합니다. |

## 가격 모델

TokenFlow는 업로드 전에 로컬에서 비용을 계산합니다.

- Built-in pricing covers known Codex, Claude, Gemini, OpenCode, and cc-switch-inspired third-party coding/provider model IDs including DeepSeek, Kimi K2, MiniMax, GLM, Qwen, Doubao, StepFun, MiMo, Grok, Mistral, and Cohere.
- Unknown models are still counted and uploaded with `pricing_status: "unpriced"`.
- Unpriced buckets record cost as `$0.000000` so token totals remain accurate and cost gaps stay visible.
- Cost calculation follows ccusage-style token accounting: fresh input, output, cache read, cache creation, optional 200k+ pricing tiers, and 1-hour cache creation at 2x input price when a source reports cache creation duration.
- For Codex and Gemini, cached input can be included in reported input and is separated before cost calculation to avoid double-counting.
- Kimi CLI keeps `kimi-for-coding` as the displayed model, while pricing resolves to K2.5 before `2026-04-20T15:28:10.072Z` and K2.6 after that cutoff, matching ccusage's documented mapping.

## 설정

환경 변수 override:

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

### 자동 동기화에서 로컬 checkout 사용

npm 배포 전에는 scheduler가 이 checkout을 실행하도록 고정할 수 있습니다.

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

배포 후에는 기본 scheduler 명령이 npm을 사용할 수 있습니다.

```bash
npx --yes @renaissancemind/tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

## 개발

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

소스는 작은 TypeScript CLI입니다.

- `src/cli.ts` - 명령 라우팅과 사용자-facing 동작.
- `src/file-scan.ts` - 로컬 Agent 탐색과 파싱 entrypoint.
- `src/sources/*` - source별 parser.
- `src/usage-buckets.ts` - UTC bucket aggregation.
- `src/pricing.ts` - pricing resolution과 cost calculation.
- `src/api.ts` - device flow, token validation, ingest calls.
- `src/scheduler.ts` - macOS launchd와 Linux systemd timer 설치.

## 제한 사항

- OpenCode, Goose, Hermes, and Kilo database reads require the `sqlite3` CLI.
- Qoder is not currently treated as a token source because ccusage has no Qoder adapter and public Qoder APIs expose credits/usage events rather than local input/output/cache token logs.
- 자동 동기화 설치는 macOS와 Linux에서만 지원됩니다. 다른 플랫폼에서는 `tokenflow sync`를 수동으로 실행하거나 직접 scheduler에 연결하세요.
- 알 수 없는 model ID의 비용은 pricing rule이 생길 때까지 `unpriced`로 표시됩니다.

## 문서

이 README가 CLI의 기본 사용자 문서입니다. 구현 세부사항은 `test/`의 집중 테스트와 `src/`의 TypeScript 모듈에서 확인할 수 있습니다.

## 기여

Issue와 pull request를 환영합니다. parser, pricing, scheduler, command 동작을 변경할 때는 집중 테스트를 함께 추가해 주세요.

## 라이선스

현재 이 repository에는 license file이 포함되어 있지 않습니다.
