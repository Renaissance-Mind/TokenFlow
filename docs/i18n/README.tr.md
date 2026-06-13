[![TokenFlow teaser](../assets/teaser_en.png)](https://tokenflow.renaissancemind.ai/)

**Dil:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | Türkçe | [Русский](README.ru.md)

> Gerçekten kullandığınız AI agent'lar için local-first token muhasebesi.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[Özellikler](#özellikler) - [Kurulum](#kurulum) - [Hızlı başlangıç](#hızlı-başlangıç) - [Komutlar](#komutlar) - [Yapılandırma](#yapılandırma) - [Geliştirme](#geliştirme)

TokenFlow, birden fazla cihazdaki AI agent kullanımını hesaplamak için kurulabilir bir yerel collector'dır. Yerel Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi kullanım verilerini tarar; token sayılarını UTC yarım saatlik bucket'larda agent ve modele göre toplar; bilinen maliyetleri hesaplar ve yalnızca kullanım metadatasını TokenFlow sunucusuna yükler.

Prompt'lar ve yanıt metinleri makinenizde kalır. Yüklenen payload sadece sayımlar, model adları, bucket zaman damgaları, pricing status ve isteğe bağlı cihaz metadatası içerir.

## Önizleme

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

## Özellikler

- 🔐 **Local-first toplama** - agent loglarını yerelde okur ve yalnızca metadata yükler.
- 🤖 **Çoklu agent desteği** - Codex, Claude Code, Gemini CLI, OpenCode, Kimi CLI, Qwen Code, Amp, Codebuff, Droid, Goose, Hermes, Kilo, OpenClaw, and Pi.
- 📊 **UTC yarım saatlik bucket'lar** - yerel kullanım detayını korurken dashboard'lar yine günlük özet gösterebilir.
- 💸 **Maliyet farkındalığı** - fresh input, cached input, cache creation, output ve reasoning output tokens ayrılır.
- 🧾 **Fiyatlandırılmamış model görünürlüğü** - bilinmeyen modeller sayılır ve `unpriced` olarak işaretlenir.
- 🔁 **Otomatik sync** - macOS `launchd` veya Linux systemd user timer ile 10 dakikalık sync job kurar.
- 🔑 **Cihaz login veya API key upload** - tarayıcı device linking ve `read_write` API token desteği sunar.
- 🛠️ **Self-host dostu** - uyumlu herhangi bir TokenFlow server URL'ine yönlendirilebilir.

## Desteklenen kaynaklar

| Kaynak | Okunan yerel veri | Notlar |
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

TokenFlow source file path, session ID, prompt veya response içeriğini yüklemez.

## Kurulum

TokenFlow için Node.js 20 veya üstü gerekir.

```bash
npm install -g @renaissancemind/tokenflow
```

OpenCode, Goose, Hermes veya Kilo desteği istiyorsanız `sqlite3` kullanılabilir olmalıdır:

```bash
sqlite3 --version
```

npm yayını öncesinde yerel checkout'tan kurulum:

```bash
npm install
npm install -g .
```

`npm install -g .` package `prepare` script'ini çalıştırır; böylece TypeScript CLI derlenir ve ardından `dist/cli.js` global komut olarak bağlanır.

## Hızlı başlangıç

### 1. Bu makineyi bağlayın

```bash
tokenflow login
```

Varsayılan olarak `login`, `https://tokenflow.renaissancemind.ai` kullanır. Bir verification URL ve user code yazdırır, mümkünse tarayıcıyı açar ve onaylanan device token'ı `~/.tokenflow/config.json` içine kaydeder.

Self-hosted sunucu kullanmak için:

```bash
tokenflow login --server-url http://127.0.0.1:8787
```

### 2. Nelerin taranacağını kontrol edin

```bash
tokenflow status
```

`status`, yerel source path'leri, parse edilen event sayısını, bucket sayısını, unpriced bucket sayısını, config konumunu ve token ayarlıysa remote auth durumunu gösterir.

### 3. Kullanımı senkronize edin

```bash
tokenflow sync
```

`sync`, yerel logları tarar, kullanımı toplar, bucket'ları idempotent biçimde yükler, sync heartbeat kaydeder ve parse edilen events ile yüklenen buckets bilgisini raporlar.

### 4. Otomatik sync kurun

```bash
tokenflow init
```

`init`, `~/.tokenflow/config.json` yazar, macOS veya Linux üzerinde her 10 dakikada çalışan otomatik sync kurar ve token yoksa tarayıcı device-link flow başlatır.

## API Token modu

Tarayıcı device linking kişisel makineler için rahattır. Sunucular, CI benzeri makineler veya script ile kurulumlar için TokenFlow server dashboard üzerinden `read_write` API key oluşturabilirsiniz:

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
```

Kullanım yüklemek için yalnızca `read_write` key'ler geçerlidir. `read_only` key'ler dashboard, API read ve public heatmap embed içindir; CLI `init` ve `login` sırasında read-only key'leri reddeder.

## Komutlar

```bash
tokenflow init --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai
tokenflow login --server-url https://tokenflow.renaissancemind.ai --api-token tu_api_...
tokenflow sync
tokenflow status
tokenflow update [--source @renaissancemind/tokenflow@latest|/path/to/TokenFlow]
tokenflow logout
```

| Komut | Ne yapar |
| --- | --- |
| `init` | Config yazar, auto-sync kurar ve isteğe bağlı olarak login başlatır. |
| `login` | Tarayıcıda onaylanmış device token bağlar veya doğrulanmış upload API token kaydeder. |
| `sync` | Yerel kullanımı parse eder, UTC yarım saatlik bucket'lar oluşturur, yükler ve `lastSyncAt` günceller. |
| `status` | Yerel config, source durumu, bucket sayıları, auth durumu ve unpriced modelleri yazdırır. |
| `update` | Global package'ı yeniden kurar ve auto-sync scheduler'ı yeniler. |
| `logout` | Yerel upload token'larını kaldırır, secret olmayan config'i korur. |

## Pricing modeli

TokenFlow maliyetleri yüklemeden önce yerelde hesaplar.

- Built-in pricing covers known Codex, Claude, Gemini, OpenCode, and cc-switch-inspired third-party coding/provider model IDs including DeepSeek, Kimi K2, MiniMax, GLM, Qwen, Doubao, StepFun, MiMo, Grok, Mistral, and Cohere.
- Unknown models are still counted and uploaded with `pricing_status: "unpriced"`.
- Unpriced buckets record cost as `$0.000000` so token totals remain accurate and cost gaps stay visible.
- Cost calculation follows ccusage-style token accounting: fresh input, output, cache read, cache creation, optional 200k+ pricing tiers, and 1-hour cache creation at 2x input price when a source reports cache creation duration.
- For Codex and Gemini, cached input can be included in reported input and is separated before cost calculation to avoid double-counting.
- Kimi CLI keeps `kimi-for-coding` as the displayed model, while pricing resolves to K2.5 before `2026-04-20T15:28:10.072Z` and K2.6 after that cutoff, matching ccusage's documented mapping.

## Yapılandırma

Environment variable override'ları:

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

### Auto-sync içinde yerel checkout kullanma

npm yayını öncesinde scheduler'ı bu checkout'a sabitleyebilirsiniz:

```bash
TOKENFLOW_AUTO_SYNC_COMMAND="node /Users/chunqiu/Documents/workspace/TokenFlow/dist/cli.js sync --auto" \
  tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

Yayından sonra varsayılan scheduler komutu npm kullanabilir:

```bash
npx --yes @renaissancemind/tokenflow init --server-url https://tokenflow.renaissancemind.ai
```

## Geliştirme

```bash
npm install
npm test
npm run typecheck
npm run build
node dist/cli.js status
```

Kaynak kod küçük bir TypeScript CLI'dır:

- `src/cli.ts` - komut routing ve kullanıcıya dönük davranış.
- `src/file-scan.ts` - yerel agent keşfi ve parsing entrypoint.
- `src/sources/*` - source'a özel parser'lar.
- `src/usage-buckets.ts` - UTC bucket aggregation.
- `src/pricing.ts` - pricing resolution ve cost calculation.
- `src/api.ts` - device flow, token validation ve ingest çağrıları.
- `src/scheduler.ts` - macOS launchd ve Linux systemd timer kurulumu.

## Sınırlamalar

- OpenCode, Goose, Hermes, and Kilo database reads require the `sqlite3` CLI.
- Qoder is not currently treated as a token source because ccusage has no Qoder adapter and public Qoder APIs expose credits/usage events rather than local input/output/cache token logs.
- Otomatik sync yalnızca macOS ve Linux üzerinde kurulur; diğer platformlarda `tokenflow sync` komutunu manuel çalıştırabilir veya kendi scheduler'ınıza bağlayabilirsiniz.
- Bilinmeyen model ID maliyetleri pricing rule eklenene kadar `unpriced` olarak işaretlenir.

## Dokümantasyon

Bu README, CLI için ana kullanıcı dokümantasyonudur. Implementasyon ayrıntıları için `test/` içindeki odaklı testlerden ve `src/` içindeki TypeScript modüllerinden başlayabilirsiniz.

## Katkı

Issue ve pull request'ler memnuniyetle karşılanır. Parser, pricing, scheduler veya command davranışı değişiklikleri için odaklı bir test ekleyin.

## Lisans

Bu repository şu anda bir license file içermiyor.
