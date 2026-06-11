# TokenFlow

**Dil:** [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja.md) | [한국어](README.ko.md) | [Español](README.es.md) | Türkçe | [Русский](README.ru.md)

> Gerçekten kullandığınız AI agent'lar için local-first token muhasebesi.

![npm](https://img.shields.io/npm/v/%40renaissancemind%2Ftokenflow?label=npm)
![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6)
![Privacy](https://img.shields.io/badge/privacy-metadata%20only-6A5ACD)

[Özellikler](#özellikler) - [Kurulum](#kurulum) - [Hızlı başlangıç](#hızlı-başlangıç) - [Komutlar](#komutlar) - [Yapılandırma](#yapılandırma) - [Geliştirme](#geliştirme)

TokenFlow, birden fazla cihazdaki AI agent kullanımını hesaplamak için kurulabilir bir yerel collector'dır. Yerel Codex, Claude Code, Gemini CLI, OpenCode ve cc-switch kullanım verilerini tarar; token sayılarını UTC günlük bucket'larda agent ve modele göre toplar; bilinen maliyetleri hesaplar ve yalnızca kullanım metadatasını TokenFlow sunucusuna yükler.

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
- 🤖 **Çoklu agent desteği** - Codex, Claude Code, Gemini CLI, OpenCode ve cc-switch.
- 📊 **UTC günlük bucket'lar** - kullanımı gün, agent ve modele göre toplayarak stabil dashboard'lar sağlar.
- 💸 **Maliyet farkındalığı** - fresh input, cached input, cache creation, output ve reasoning output tokens ayrılır.
- 🧾 **Fiyatlandırılmamış model görünürlüğü** - bilinmeyen modeller sayılır ve `unpriced` olarak işaretlenir.
- 🔁 **Otomatik sync** - macOS `launchd` veya Linux systemd user timer ile 10 dakikalık sync job kurar.
- 🔑 **Cihaz login veya API key upload** - tarayıcı device linking ve `read_write` API token desteği sunar.
- 🛠️ **Self-host dostu** - uyumlu herhangi bir TokenFlow server URL'ine yönlendirilebilir.

## Desteklenen kaynaklar

| Kaynak | Okunan yerel veri | Notlar |
| --- | --- | --- |
| Codex | `~/.codex/sessions/**/rollout-*.jsonl` ve archived session JSONL | Yerel rollout token event'lerini parse eder. |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Proje JSONL kullanım verisini parse eder. |
| Gemini CLI | `~/.gemini/tmp/**/chats/session-*.json` | Gemini session JSON dosyalarını parse eder. |
| OpenCode | `~/.local/share/opencode/opencode.db` | `PATH` üzerinde `sqlite3` gerekir. |
| cc-switch | `~/.cc-switch/cc-switch.db` | Varsayılan olarak pricing okur; `proxy_request_logs` yalnızca `CC_SWITCH_DB` ayarlıysa import edilir. |

TokenFlow source file path, session ID, prompt veya yanıt metni yüklemez.

## Kurulum

TokenFlow için Node.js 20 veya üstü gerekir.

```bash
npm install -g @renaissancemind/tokenflow
```

OpenCode veya cc-switch desteği istiyorsanız `sqlite3` kullanılabilir olmalıdır:

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
| `sync` | Yerel kullanımı parse eder, UTC günlük bucket'lar oluşturur, yükler ve `lastSyncAt` günceller. |
| `status` | Yerel config, source durumu, bucket sayıları, auth durumu ve unpriced modelleri yazdırır. |
| `update` | Global package'ı yeniden kurar ve auto-sync scheduler'ı yeniler. |
| `logout` | Yerel upload token'larını kaldırır, secret olmayan config'i korur. |

## Pricing modeli

TokenFlow upload öncesinde maliyetleri yerelde hesaplar.

- Built-in pricing bilinen Codex, Claude ve Gemini model ID'lerini kapsar.
- cc-switch database varsa cc-switch `model_pricing` yerel pricing'i genişletebilir veya override edebilir.
- Bilinmeyen modeller yine sayılır ve `pricing_status: "unpriced"` ile yüklenir.
- Unpriced bucket maliyeti `$0.000000` olarak kaydedilir; token toplamları doğru kalır ve maliyet boşlukları görünür olur.
- Codex ve Gemini için cached input, reported input'un parçası olarak ele alınır ve double-counting önlemek için maliyet hesabından önce ayrılır.

## Yapılandırma

Ortam değişkeni override'ları:

| Değişken | Amaç |
| --- | --- |
| `TOKENFLOW_HOME` | Yerel state dizini. Varsayılan `~/.tokenflow`. |
| `TOKENFLOW_SERVER_URL` | Varsayılan server URL. |
| `TOKENFLOW_AUTO_SYNC_COMMAND` | launchd/systemd içine yazılan komut. Varsayılan `npx --yes @renaissancemind/tokenflow@latest sync --auto`. |
| `TOKENFLOW_UPDATE_SOURCE` | `tokenflow update` sırasında `--source` yoksa kullanılacak package/source. |
| `CODEX_HOME` | Codex config home. Varsayılan `~/.codex`. |
| `CLAUDE_HOME` | Claude config home. Varsayılan `~/.claude`. |
| `GEMINI_HOME` | Gemini config home. Varsayılan `~/.gemini`. |
| `OPENCODE_DB` | Açık OpenCode SQLite database path. |
| `OPENCODE_HOME` | OpenCode data home. Varsayılan `~/.local/share/opencode`. |
| `XDG_DATA_HOME` | `OPENCODE_DB` ve `OPENCODE_HOME` yoksa OpenCode data çözümlemesi için kullanılır. |
| `CC_SWITCH_DB` | Açık cc-switch SQLite path. `proxy_request_logs` import ve pricing read'i etkinleştirir. |

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

- OpenCode ve cc-switch database okumaları için `sqlite3` CLI gerekir.
- Otomatik sync yalnızca macOS ve Linux üzerinde kurulur; diğer platformlarda `tokenflow sync` manuel çalıştırılabilir veya kendi scheduler'ınıza bağlanabilir.
- cc-switch request logs, `CC_SWITCH_DB` açıkça ayarlanmadıkça import edilmez; bu, native Codex, Claude ve Gemini loglarıyla double-counting önler.
- Bilinmeyen model ID maliyetleri, pricing rule eklenene kadar `unpriced` olarak işaretlenir.

## Dokümantasyon

Bu README, CLI için ana kullanıcı dokümantasyonudur. Implementasyon ayrıntıları için `test/` içindeki odaklı testlerden ve `src/` içindeki TypeScript modüllerinden başlayabilirsiniz.

## Katkı

Issue ve pull request'ler memnuniyetle karşılanır. Parser, pricing, scheduler veya command davranışı değişiklikleri için odaklı bir test ekleyin.

## Lisans

Bu repository şu anda bir license file içermiyor.
