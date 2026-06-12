[![TokenFlow teaser](../assets/teaser_en.png)](https://tokenflow.renaissancemind.ai/)

**Idioma:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | Español | [Türkçe](README.tr.md) | [Русский](README.ru.md)

> Contabilidad de tokens local-first para los AI agents que realmente usas.

![npm](https://img.shields.io/npm/v/tokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[Características](#características) - [Instalación](#instalación) - [Inicio rápido](#inicio-rápido) - [Comandos](#comandos) - [Configuración](#configuración) - [Desarrollo](#desarrollo)

TokenFlow es un collector local instalable para contabilizar el uso de AI agents en varios dispositivos. Escanea datos locales de Codex, Claude Code, Gemini CLI, OpenCode y cc-switch, agrega tokens en buckets diarios UTC por agent y modelo, calcula costos conocidos y sube solo metadatos de uso a un servidor TokenFlow.

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
- 🤖 **Soporte multi-agent** - Codex, Claude Code, Gemini CLI, OpenCode y cc-switch.
- 📊 **Buckets diarios UTC** - agrega uso por día, agent y modelo para dashboards estables.
- 💸 **Contabilidad consciente del costo** - separa fresh input, cached input, cache creation, output y reasoning output tokens.
- 🧾 **Visibilidad de modelos sin precio** - los modelos desconocidos se cuentan y se marcan como `unpriced`.
- 🔁 **Sincronización automática** - instala un job de 10 minutos con macOS `launchd` o Linux systemd user timers.
- 🔑 **Login de dispositivo o API key** - soporta device linking en navegador y tokens API `read_write`.
- 🛠️ **Listo para self-hosting** - permite apuntar a cualquier TokenFlow server URL compatible.

## Fuentes soportadas

| Fuente | Datos locales leídos | Notas |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` y archived session JSONL | Parsea eventos locales de rollout token. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Parsea datos de uso en JSONL de proyectos. |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Parsea archivos JSON de sesiones Gemini. |
| OpenCode | `~/.local/share/opencode/opencode.db` | Requiere `sqlite3` en `PATH`. |
| cc-switch | `~/.cc-switch/cc-switch.db` | Lee pricing por defecto; importa `proxy_request_logs` solo cuando `CC_SWITCH_DB` está definido. |

TokenFlow no sube rutas de archivos fuente, session IDs, prompts ni respuestas.

## Instalación

TokenFlow requiere Node.js 20 o superior.

```bash
npm install -g tokenflow
```

Si quieres soporte para OpenCode o cc-switch, asegúrate de tener `sqlite3` disponible:

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
tokenflow update [--source tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| Comando | Qué hace |
| --- | --- |
| `init` | Escribe config, instala auto-sync y opcionalmente inicia login. |
| `login` | Vincula un device token aprobado en navegador o guarda un upload API token validado. |
| `sync` | Parsea uso local, construye buckets diarios UTC, los sube y actualiza `lastSyncAt`. |
| `status` | Imprime config local, disponibilidad de sources, buckets, estado de auth y modelos sin precio. |
| `update` | Reinstala el package global y refresca el scheduler de auto-sync. |
| `logout` | Elimina tokens locales de subida y conserva la config no secreta. |

## Modelo de precios

TokenFlow calcula costos localmente antes de subir datos.

- El pricing integrado cubre IDs conocidos de modelos Codex, Claude y Gemini.
- `model_pricing` de cc-switch puede extender o sobrescribir el pricing local cuando existe su base de datos.
- Los modelos desconocidos se siguen contando y se suben con `pricing_status: "unpriced"`.
- Los buckets sin precio registran costo como `$0.000000`, así los totales de tokens siguen siendo correctos y las brechas de costo siguen visibles.
- Para Codex y Gemini, cached input se trata como parte del reported input y se separa antes del cálculo de costo para evitar doble conteo.

## Configuración

Overrides por variables de entorno:

| Variable | Propósito |
| --- | --- |
| `TOKENFLOW_HOME` | Directorio de estado local. Por defecto `~/.tokenflow`. |
| `TOKENFLOW_SERVER_URL` | URL del servidor por defecto. |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | Comando escrito en launchd/systemd. Por defecto `npx --yes tokenflow@latest sync --auto`. |
| `TOKENFLOW_UPDATE_SOURCE` | Package/source usado por `tokenflow update` cuando se omite `--source`. |
| `CODEX_HOME` | Home de configuración de Codex. Por defecto `~/.codex`. |
| `CLAUDE_HOME` | Home de configuración de Claude. Por defecto `~/.claude`. |
| `GEMINI_HOME` | Home de configuración de Gemini. Por defecto `~/.gemini`. |
| `OPENCODE_DB` | Ruta explícita de la base SQLite de OpenCode. |
| `OPENCODE_HOME` | Home de datos de OpenCode. Por defecto `~/.local/share/opencode`. |
| `XDG_DATA_HOME` | Se usa para resolver datos de OpenCode cuando `OPENCODE_DB` y `OPENCODE_HOME` no están definidos. |
| `CC_SWITCH_DB` | Ruta SQLite explícita de cc-switch. Habilita import de `proxy_request_logs` y lectura de pricing. |

### Usar un checkout local en auto-sync

Antes de publicar en npm, puedes fijar el scheduler a este checkout:

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

Después de publicar, el comando por defecto del scheduler puede usar npm:

```bash
npx --yes tokenflow init --server-url https://tokenflow.renaissancemind.ai
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

- Las lecturas de bases OpenCode y cc-switch requieren el CLI `sqlite3`.
- La sincronización automática solo se instala en macOS y Linux; en otras plataformas puedes ejecutar `tokenflow sync` manualmente o conectarlo a tu propio scheduler.
- Los request logs de cc-switch no se importan salvo que `CC_SWITCH_DB` esté definido explícitamente, lo que evita doble conteo junto a logs nativos de Codex, Claude y Gemini.
- Los costos de model IDs desconocidos se marcan como `unpriced` hasta que exista una regla de pricing.

## Documentación

Este README es la documentación principal de usuario para el CLI. Para detalles de implementación, empieza por los tests enfocados en `test/` y los módulos TypeScript en `src/`.

## Contribuir

Issues y pull requests son bienvenidos. Incluye un test enfocado para cambios en parsers, pricing, scheduler o comportamiento de comandos.

## Licencia

Este repositorio no incluye actualmente un archivo de licencia.
