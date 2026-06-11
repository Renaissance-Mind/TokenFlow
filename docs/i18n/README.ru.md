# TokenFlow

**Язык:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | [Türkçe](README.tr.md) | Русский

> Local-first учет token usage для AI agents, которыми вы действительно пользуетесь.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[Возможности](#возможности) - [Установка](#установка) - [Быстрый старт](#быстрый-старт) - [Команды](#команды) - [Конфигурация](#конфигурация) - [Разработка](#разработка)

TokenFlow — устанавливаемый локальный collector для учета использования AI agents на нескольких устройствах. Он сканирует локальные данные Codex, Claude Code, Gemini CLI, OpenCode и cc-switch, агрегирует token counts в дневные UTC buckets по agent и модели, рассчитывает известные costs и загружает на сервер TokenFlow только usage metadata.

Prompts и ответы остаются на вашей машине. Загружаемый payload содержит только счетчики, имена моделей, timestamps buckets, pricing status и необязательные device metadata.

## Превью

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

## Возможности

- 🔐 **Local-first сбор** - читает agent logs локально и загружает только metadata.
- 🤖 **Поддержка нескольких agents** - Codex, Claude Code, Gemini CLI, OpenCode и cc-switch.
- 📊 **Дневные UTC buckets** - агрегирует usage по дню, agent и модели для стабильных dashboards.
- 💸 **Cost-aware учет** - разделяет fresh input, cached input, cache creation, output и reasoning output tokens.
- 🧾 **Видимость моделей без цены** - неизвестные модели учитываются и помечаются как `unpriced`.
- 🔁 **Автоматическая синхронизация** - устанавливает 10-минутный job через macOS `launchd` или Linux systemd user timers.
- 🔑 **Device login или API key upload** - поддерживает browser device linking и `read_write` API tokens.
- 🛠️ **Удобно для self-hosting** - можно указать любой совместимый TokenFlow server URL.

## Поддерживаемые источники

| Источник | Локальные данные | Примечания |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` и archived session JSONL | Парсит локальные rollout token events. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Парсит project JSONL usage data. |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Парсит Gemini session JSON files. |
| OpenCode | `~/.local/share/opencode/opencode.db` | Требует `sqlite3` в `PATH`. |
| cc-switch | `~/.cc-switch/cc-switch.db` | По умолчанию читает pricing; импортирует `proxy_request_logs` только если задан `CC_SWITCH_DB`. |

TokenFlow не загружает source file paths, session IDs, prompts или тексты ответов.

## Установка

TokenFlow требует Node.js 20 или новее.

```bash
npm install -g @renaissancemind/tokenflow
```

Если нужен support для OpenCode или cc-switch, убедитесь, что доступен `sqlite3`:

```bash
sqlite3 --version
```

Установка из локального checkout до публикации в npm:

```bash
npm install
npm install -g .
```

`npm install -g .` запускает package `prepare` script, поэтому TypeScript CLI компилируется до того, как npm свяжет `dist/cli.js`.

## Быстрый старт

### 1. Привяжите эту машину

```bash
tokenflow login
```

По умолчанию `login` использует `https://tokenflow.renaissancemind.ai`. Он печатает verification URL и user code, открывает браузер при возможности и сохраняет одобренный device token в `~/.tokenflow/config.json`.

Для self-hosted сервера:

```bash
tokenflow login --server-url http://127.0.0.1:8787
```

### 2. Проверьте, что будет сканироваться

```bash
tokenflow status
```

`status` показывает локальные source paths, количество parsed events, bucket counts, unpriced bucket counts, расположение config и remote auth status, если token настроен.

### 3. Синхронизируйте usage

```bash
tokenflow sync
```

`sync` сканирует локальные logs, агрегирует usage, идемпотентно загружает buckets, записывает sync heartbeat и сообщает parsed events и uploaded buckets.

### 4. Установите автоматическую синхронизацию

```bash
tokenflow init
```

`init` записывает `~/.tokenflow/config.json`, устанавливает автоматическую синхронизацию каждые 10 минут на macOS или Linux, затем запускает browser device-link flow, если token еще нет.

## Режим API Token

Browser device linking удобен для личных машин. Для серверов, CI-like машин или scripted installs создайте `read_write` API key в dashboard сервера TokenFlow:

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
```

Загружать usage могут только `read_write` keys. `read_only` keys предназначены для dashboards, API reads и public heatmap embeds; CLI отклоняет read-only keys во время `init` и `login`.

## Команды

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
tokenflow sync
tokenflow status
tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| Команда | Что делает |
| --- | --- |
| `init` | Записывает config, устанавливает auto-sync и при необходимости запускает login. |
| `login` | Привязывает browser-approved device token или сохраняет validated upload API token. |
| `sync` | Парсит local usage, строит UTC daily buckets, загружает их и обновляет `lastSyncAt`. |
| `status` | Печатает local config, source availability, bucket counts, auth status и unpriced models. |
| `update` | Переустанавливает global package и обновляет auto-sync scheduler. |
| `logout` | Удаляет local upload tokens, сохраняя non-secret config. |

## Pricing model

TokenFlow рассчитывает costs локально перед upload.

- Built-in pricing покрывает известные Codex, Claude и Gemini model IDs.
- cc-switch `model_pricing` может расширять или переопределять local pricing, если база данных существует.
- Неизвестные модели все равно учитываются и загружаются с `pricing_status: "unpriced"`.
- Unpriced buckets записывают cost как `$0.000000`, поэтому token totals остаются корректными, а cost gaps остаются видимыми.
- Для Codex и Gemini cached input считается частью reported input и отделяется перед cost calculation, чтобы избежать double-counting.

## Конфигурация

Переопределение через environment variables:

| Переменная | Назначение |
| --- | --- |
| `TOKENFLOW_HOME` | Локальный state directory. По умолчанию `~/.tokenflow`. |
| `TOKENFLOW_SERVER_URL` | Default server URL. |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | Команда, записываемая в launchd/systemd. По умолчанию `npx --yes @renaissancemind/tokenflow@latest sync --auto`. |
| `TOKENFLOW_UPDATE_SOURCE` | Package/source для `tokenflow update`, если `--source` не указан. |
| `CODEX_HOME` | Codex config home. По умолчанию `~/.codex`. |
| `CLAUDE_HOME` | Claude config home. По умолчанию `~/.claude`. |
| `GEMINI_HOME` | Gemini config home. По умолчанию `~/.gemini`. |
| `OPENCODE_DB` | Явный OpenCode SQLite database path. |
| `OPENCODE_HOME` | OpenCode data home. По умолчанию `~/.local/share/opencode`. |
| `XDG_DATA_HOME` | Используется для OpenCode data, если `OPENCODE_DB` и `OPENCODE_HOME` не заданы. |
| `CC_SWITCH_DB` | Явный cc-switch SQLite path. Включает импорт `proxy_request_logs` и чтение pricing. |

### Локальный checkout для auto-sync

До публикации в npm можно закрепить scheduler за этим checkout:

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

После публикации default scheduler command может использовать npm:

```bash
npx --yes @renaissancemind/tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

## Разработка

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

Source code — небольшой TypeScript CLI:

- `src/cli.ts` - command routing и user-facing behavior.
- `src/file-scan.ts` - local agent discovery и parsing entrypoint.
- `src/sources/*` - source-specific parsers.
- `src/usage-buckets.ts` - UTC bucket aggregation.
- `src/pricing.ts` - pricing resolution и cost calculation.
- `src/api.ts` - device flow, token validation и ingest calls.
- `src/scheduler.ts` - установка macOS launchd и Linux systemd timer.

## Ограничения

- Для чтения баз OpenCode и cc-switch нужен `sqlite3` CLI.
- Автоматическая синхронизация устанавливается только на macOS и Linux; на других платформах можно запускать `tokenflow sync` вручную или подключить свой scheduler.
- cc-switch request logs не импортируются, если `CC_SWITCH_DB` не задан явно. Это предотвращает double-counting вместе с native Codex, Claude и Gemini logs.
- Costs для неизвестных model IDs помечаются как `unpriced`, пока не появится pricing rule.

## Документация

Этот README является основной пользовательской документацией для CLI. Детали реализации можно начать изучать с focused tests в `test/` и TypeScript modules в `src/`.

## Contributing

Issues и pull requests приветствуются. Для изменений parser, pricing, scheduler или command behavior добавляйте focused test.

## Лицензия

В этом репозитории сейчас нет license file.
