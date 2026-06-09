# TokenUsage

**언어:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | 한국어 | [Español](README.es.md) | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> 실제로 사용하는 AI Agent의 token 사용량을 로컬 우선 방식으로 집계합니다.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenusage?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[기능](#기능) - [설치](#설치) - [빠른 시작](#빠른-시작) - [명령어](#명령어) - [설정](#설정) - [개발](#개발)

TokenUsage는 여러 기기에서 사용하는 AI Agent의 사용량을 집계하는 설치형 로컬 collector입니다. 로컬의 Codex, Claude Code, Gemini CLI, OpenCode, cc-switch 사용 데이터를 스캔하고, UTC 날짜, Agent, 모델별로 token 수를 집계하며, 알려진 모델의 비용을 계산한 뒤 사용 메타데이터만 TokenUsage 서버로 업로드합니다.

프롬프트와 응답 본문은 사용자의 머신에 남습니다. 업로드되는 payload에는 count, 모델명, bucket timestamp, pricing status, 선택적인 device metadata만 포함됩니다.

## 미리보기

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

## 기능

- 🔐 **로컬 우선 수집** - Agent 로그를 로컬에서 읽고 메타데이터만 업로드합니다.
- 🤖 **다중 Agent 지원** - Codex, Claude Code, Gemini CLI, OpenCode, cc-switch를 지원합니다.
- 📊 **UTC 일 단위 bucket** - 날짜, Agent, 모델별로 집계해 대시보드 표시와 동기화를 안정적으로 만듭니다.
- 💸 **비용 인식 집계** - fresh input, cached input, cache creation, output, reasoning output tokens를 분리합니다.
- 🧾 **미가격 모델 가시화** - 알 수 없는 모델도 token으로 집계하고 `unpriced`로 표시합니다.
- 🔁 **자동 동기화** - macOS `launchd` 또는 Linux systemd user timer에 10분 간격 동기화를 설치합니다.
- 🔑 **기기 로그인 또는 API key 업로드** - 브라우저 기기 승인과 `read_write` API token을 지원합니다.
- 🛠️ **셀프 호스팅 친화적** - 호환되는 TokenUsage server URL을 직접 지정할 수 있습니다.

## 지원 소스

| 소스 | 읽는 로컬 데이터 | 참고 |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` 및 archived session JSONL | 로컬 rollout token event를 파싱합니다. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | 프로젝트 JSONL 사용 데이터를 파싱합니다. |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Gemini session JSON 파일을 파싱합니다. |
| OpenCode | `~/.local/share/opencode/opencode.db` | `PATH`에 `sqlite3`가 필요합니다. |
| cc-switch | `~/.cc-switch/cc-switch.db` | 기본적으로 pricing table을 읽습니다. `proxy_request_logs`는 `CC_SWITCH_DB`를 설정한 경우에만 가져옵니다. |

TokenUsage는 source file path, session ID, prompt, response 본문을 업로드하지 않습니다.

## 설치

TokenUsage는 Node.js 20 이상이 필요합니다.

```bash
npm install -g @renaissancemind/tokenusage
```

OpenCode 또는 cc-switch 지원이 필요하다면 `sqlite3`를 사용할 수 있는지 확인하세요.

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
tokenusage login
```

기본적으로 `login`은 `https://tokenusage.renaissancemind.ai`를 사용합니다. verification URL과 user code를 출력하고, 가능하면 브라우저를 열며, 승인된 device token을 `~/.tokenusage/config.json`에 저장합니다.

셀프 호스팅 서버를 사용하려면:

```bash
tokenusage login --server-url http://127.0.0.1:8787
```

### 2. 스캔 대상을 확인

```bash
tokenusage status
```

`status`는 로컬 source path, 파싱된 event 수, bucket 수, unpriced bucket 수, config 위치, token이 설정된 경우 remote auth 상태를 보여줍니다.

### 3. 사용량 동기화

```bash
tokenusage sync
```

`sync`는 로컬 로그를 스캔하고, 사용량을 집계하고, bucket을 멱등적으로 업로드하고, sync heartbeat를 기록한 뒤 파싱된 events와 업로드된 buckets를 보고합니다.

### 4. 자동 동기화 설치

```bash
tokenusage init
```

`init`은 `~/.tokenusage/config.json`을 작성하고, macOS 또는 Linux에서 10분마다 실행되는 자동 동기화를 설치한 뒤, token이 없으면 브라우저 기기 승인 flow를 시작합니다.

## API Token 모드

브라우저 기기 승인은 개인 머신에 편리합니다. 서버, CI 성격의 머신, 스크립트 설치에는 TokenUsage server dashboard에서 `read_write` API key를 만들어 사용할 수 있습니다.

```bash
tokenusage init --server-url https://tokenusage.renaissancemind.ai --api-token tu_api_...
```

사용량 업로드에는 `read_write` key만 사용할 수 있습니다. `read_only` key는 dashboard, API read, public heatmap embed용입니다. CLI는 `init`과 `login` 단계에서 read-only key를 거부합니다.

## 명령어

```bash
tokenusage init --server-url https://tokenusage.renaissancemind.ai
tokenusage login --server-url https://tokenusage.renaissancemind.ai
tokenusage login --server-url https://tokenusage.renaissancemind.ai --api-token tu_api_...
tokenusage sync
tokenusage status
tokenusage update [--source @renaissancemind/tokenusage@latest|/path/to/TokenUsage]
tokenusage logout
```

| 명령어 | 설명 |
| --- | --- |
| `init` | config를 작성하고 자동 동기화를 설치하며, 필요하면 login을 시작합니다. |
| `login` | 브라우저 승인 device token을 연결하거나 검증된 upload API token을 저장합니다. |
| `sync` | 로컬 사용량을 파싱하고 UTC 일 단위 bucket을 만들고 업로드한 뒤 `lastSyncAt`을 갱신합니다. |
| `status` | 로컬 config, source 사용 가능 여부, bucket 수, auth 상태, unpriced models를 출력합니다. |
| `update` | 전역 package를 다시 설치하고 자동 동기화 scheduler를 갱신합니다. |
| `logout` | 로컬 upload token을 제거하고 non-secret config는 유지합니다. |

## 가격 모델

TokenUsage는 업로드 전에 로컬에서 비용을 계산합니다.

- 내장 pricing은 알려진 Codex, Claude, Gemini model ID를 포함합니다.
- cc-switch database가 있으면 cc-switch `model_pricing`으로 로컬 pricing을 확장하거나 덮어쓸 수 있습니다.
- 알 수 없는 모델도 집계되고 `pricing_status: "unpriced"`로 업로드됩니다.
- unpriced bucket의 비용은 `$0.000000`으로 기록되어 token total은 정확하게 유지되고 비용 누락도 보입니다.
- Codex와 Gemini에서는 cached input이 reported input의 일부로 처리되며, 비용 계산 전에 분리되어 중복 계산을 피합니다.

## 설정

환경 변수 override:

| 변수 | 용도 |
| --- | --- |
| `TOKENUSAGE_HOME` | 로컬 상태 디렉터리. 기본값은 `~/.tokenusage`. |
| `TOKENUSAGE_SERVER_URL` | 기본 서버 URL. |
| `TOKENUSAGE_AUTO_SYNC_COMMAND` | launchd/systemd에 기록되는 명령. 기본값은 `npx --yes @renaissancemind/tokenusage@latest sync --auto`. |
| `TOKENUSAGE_UPDATE_SOURCE` | `tokenusage update`에서 `--source`를 생략했을 때 사용할 package/source. |
| `CODEX_HOME` | Codex config home. 기본값은 `~/.codex`. |
| `CLAUDE_HOME` | Claude config home. 기본값은 `~/.claude`. |
| `GEMINI_HOME` | Gemini config home. 기본값은 `~/.gemini`. |
| `OPENCODE_DB` | 명시적인 OpenCode SQLite database path. |
| `OPENCODE_HOME` | OpenCode data home. 기본값은 `~/.local/share/opencode`. |
| `XDG_DATA_HOME` | `OPENCODE_DB`와 `OPENCODE_HOME`이 없을 때 OpenCode data를 찾는 데 사용됩니다. |
| `CC_SWITCH_DB` | 명시적인 cc-switch SQLite path. `proxy_request_logs` import와 pricing read를 활성화합니다. |

### 자동 동기화에서 로컬 checkout 사용

npm 배포 전에는 scheduler가 이 checkout을 실행하도록 고정할 수 있습니다.

```bash
TOKENUSAGE_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenUsage/dist/cli.js sync --auto" \
  tokenusage init --server-url https://tokenusage.renaissancemind.ai
```

배포 후에는 기본 scheduler 명령이 npm을 사용할 수 있습니다.

```bash
npx --yes @renaissancemind/tokenusage init --server-url https://tokenusage.renaissancemind.ai
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

- OpenCode와 cc-switch database read에는 `sqlite3` CLI가 필요합니다.
- 자동 동기화 설치는 macOS와 Linux에서만 지원됩니다. 다른 플랫폼에서는 `tokenusage sync`를 수동으로 실행하거나 직접 scheduler에 연결하세요.
- cc-switch request logs는 `CC_SWITCH_DB`를 명시한 경우에만 import됩니다. 이는 native Codex, Claude, Gemini logs와의 중복 집계를 피하기 위함입니다.
- 알 수 없는 model ID의 비용은 pricing rule이 생길 때까지 `unpriced`로 표시됩니다.

## 문서

이 README가 CLI의 기본 사용자 문서입니다. 구현 세부사항은 `test/`의 집중 테스트와 `src/`의 TypeScript 모듈에서 확인할 수 있습니다.

## 기여

Issue와 pull request를 환영합니다. parser, pricing, scheduler, command 동작을 변경할 때는 집중 테스트를 함께 추가해 주세요.

## 라이선스

현재 이 repository에는 license file이 포함되어 있지 않습니다.
