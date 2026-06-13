[![TokenFlow teaser](../assets/teaser_en.png)](https://tokenflow.renaissancemind.ai/)

**Idioma:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | Español | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> Contabilidad de tokens local-first para los AI agents que realmente usas.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[Características](#características) - [Instalación](#instalación) - [Inicio rápido](#inicio-rápido) - [Comandos](#comandos) - [Configuración](#configuración) - [Desarrollo](#desarrollo)

TokenFlow es un collector local instalable para contabilizar el uso de AI agents en varios dispositivos. Escanea datos locales de Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi, agrega tokens en buckets UTC de media hora por agent y modelo, calcula costos conocidos y sube solo metadatos de uso a un servidor TokenFlow.

Los prompts y las respuestas permanecen en tu máquina. El payload subido contiene conteos, nombres de modelos, timestamps de buckets, estado de pricing y metadatos opcionales del dispositivo.

## Vista previa

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

## Características

- 🔐 **Colección local-first** - lee logs de agents localmente y sube solo metadatos.
- 🤖 **Soporte multi-agent** - Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi.
- 📊 **Buckets UTC de media hora** - conserva detalle local mientras los dashboards pueden resumir por día.
- 💸 **Contabilidad consciente del costo** - separa fresh input, cached input, cache creation, output y reasoning output tokens.
- 🧾 **Visibilidad de modelos sin precio** - los modelos desconocidos se cuentan y se marcan como `unpriced`.
- 🔁 **Sincronización automática** - instala un job de 10 minutos con macOS `launchd` o Linux systemd user timers.
- 🔑 **Login de dispositivo o API key** - soporta device linking en navegador y tokens API `read_write`.
- 🛠️ **Listo para self-hosting** - permite apuntar a cualquier TokenFlow server URL compatible.

## Fuentes soportadas

| Fuente | Datos locales leídos | Notas |
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

TokenFlow no sube rutas de archivos fuente, session IDs, prompts ni respuestas.

## Instalación

TokenFlow requiere Node.js 20 o superior.

```bash
npm install -g @renaissancemind/tokenflow
```

Si quieres soporte para OpenCode, Goose, Hermes o Kilo, asegúrate de tener `sqlite3` disponible:

```bash
sqlite3 --version
```

Desde un checkout local antes de publicar en npm:

```bash
npm install
npm install -g .
```

`npm install -g .` ejecuta el script `prepare` del package, por lo que compila el CLI TypeScript antes de enlazar `dist/cli.js`.

## Inicio rápido

### 1. Vincula esta máquina

```bash
tokenflow login
```

Por defecto, `login` usa `https://tokenflow.renaissancemind.ai`. Imprime una verification URL y un user code, abre el navegador cuando es posible y guarda el device token aprobado en `~/.tokenflow/config.json`.

Para usar un servidor self-hosted:

```bash
tokenflow login --server-url http://127.0.0.1:8787
```

### 2. Revisa qué se va a escanear

```bash
tokenflow status
```

`status` muestra rutas locales de sources, cantidad de events parseados, cantidad de buckets, buckets sin precio, ubicación de config y estado de autenticación remota cuando hay un token configurado.

### 3. Sincroniza uso

```bash
tokenflow sync
```

`sync` escanea logs locales, agrega uso, sube buckets de forma idempotente, registra un heartbeat de sincronización y reporta events parseados y buckets subidos.

### 4. Instala sincronización automática

```bash
tokenflow init
```

`init` escribe `~/.tokenflow/config.json`, instala sincronización automática cada 10 minutos en macOS o Linux y luego inicia el device-link flow en navegador si todavía no hay token.

## Modo API Token

El device linking en navegador es cómodo para máquinas personales. Para servidores, máquinas tipo CI o instalaciones automatizadas, crea una API key `read_write` en el dashboard del servidor TokenFlow:

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
```

Solo las keys `read_write` pueden subir uso. Las keys `read_only` son para dashboards, lecturas de API y embeds públicos de heatmap; el CLI rechaza keys read-only durante `init` y `login`.

## Comandos

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
tokenflow sync
tokenflow status
tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| Comando | Qué hace |
| --- | --- |
| `init` | Escribe config, instala auto-sync y opcionalmente inicia login. |
| `login` | Vincula un device token aprobado en navegador o guarda un upload API token validado. |
| `sync` | Parsea uso local, construye buckets UTC de media hora, los sube y actualiza `lastSyncAt`. |
| `status` | Imprime config local, disponibilidad de sources, buckets, estado de auth y modelos sin precio. |
| `update` | Reinstala el package global y refresca el scheduler de auto-sync. |
| `logout` | Elimina tokens locales de subida y conserva la config no secreta. |

## Modelo de precios

TokenFlow calcula costos localmente antes de subir datos.

- Built-in pricing covers known Codex, Claude, Gemini, OpenCode, and cc-switch-inspired third-party coding/provider model IDs including DeepSeek, Kimi K2, MiniMax, GLM, Qwen, Doubao, StepFun, MiMo, Grok, Mistral, and Cohere.
- Unknown models are still counted and uploaded with `pricing_status: "unpriced"`.
- Unpriced buckets record cost as `$0.000000` so token totals remain accurate and cost gaps stay visible.
- Cost calculation follows ccusage-style token accounting: fresh input, output, cache read, cache creation, optional 200k+ pricing tiers, and 1-hour cache creation at 2x input price when a source reports cache creation duration.
- For Codex and Gemini, cached input can be included in reported input and is separated before cost calculation to avoid double-counting.
- Kimi CLI keeps `kimi-for-coding` as the displayed model, while pricing resolves to K2.5 before `2026-04-20T15:28:10.072Z` and K2.6 after that cutoff, matching ccusage's documented mapping.

## Configuración

Overrides por variables de entorno:

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

### Usar un checkout local en auto-sync

Antes de publicar en npm, puedes fijar el scheduler a este checkout:

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

Después de publicar, el comando por defecto del scheduler puede usar npm:

```bash
npx --yes @renaissancemind/tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

## Desarrollo

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

El código fuente es un CLI TypeScript pequeño:

- `src/cli.ts` - routing de comandos y comportamiento de cara al usuario.
- `src/file-scan.ts` - descubrimiento local de agents y entrada de parsing.
- `src/sources/*` - parsers específicos de cada source.
- `src/usage-buckets.ts` - agregación de buckets UTC.
- `src/pricing.ts` - resolución de pricing y cálculo de costos.
- `src/api.ts` - device flow, validación de tokens y llamadas ingest.
- `src/scheduler.ts` - instalación de timers macOS launchd y Linux systemd.

## Limitaciones

- OpenCode, Goose, Hermes, and Kilo database reads require the `sqlite3` CLI.
- Qoder is not currently treated as a token source because ccusage has no Qoder adapter and public Qoder APIs expose credits/usage events rather than local input/output/cache token logs.
- La sincronización automática solo se instala en macOS y Linux; en otras plataformas puedes ejecutar `tokenflow sync` manualmente o conectarlo a tu propio scheduler.
- Los costos de model IDs desconocidos se marcan como `unpriced` hasta que exista una regla de pricing.

## Documentación

Este README es la documentación principal de usuario para el CLI. Para detalles de implementación, empieza por los tests enfocados en `test/` y los módulos TypeScript en `src/`.

## Contribuir

Issues y pull requests son bienvenidos. Incluye un test enfocado para cambios en parsers, pricing, scheduler o comportamiento de comandos.

## Licencia

Este repositorio no incluye actualmente un archivo de licencia.
