# Third-Party Notices

TokenFlow includes implementation ideas and behavior derived from the following MIT-licensed
projects. The adapter and product references are not runtime dependencies;
runtime libraries are identified separately below.

## ccusage

- Project: https://github.com/ccusage/ccusage
- Copyright: Copyright (c) 2025 ryoppippi
- License: MIT
- Used for: local agent source discovery patterns, token field mapping, Kimi/Qwen parsing behavior,
  Grok/ZCode ledger accounting, Antigravity protobuf field mappings, OpenClaw SQLite migration,
  Codex compaction/fork deduplication, Pi stores, and cost accounting semantics.

## cc-switch

- Project: https://github.com/farion1231/cc-switch
- License: MIT
- Used for: model alias/pricing references and coding-provider usage behavior research.

## vibe-usage

- Project: https://github.com/vibe-cafe/vibe-usage
- License: MIT
- Used for: CLI product-flow references around local collection and upload.

## DeepSeek Harness

- Project: https://github.com/deepseek-ai/deepseek-harness
- Copyright: Copyright (c) 2026 DeepSeek
- License: MIT
- Used for: dsh Session log discovery, versioned physical formats, token-field semantics,
  inherited-history boundaries, and retry/settlement accounting. TokenFlow reads local
  logs with its own adapter and does not run or vendor the harness.

## fzstd (runtime dependency)

- Project: https://github.com/101arrowz/fzstd
- Copyright: Copyright (c) 2020 Arjun Barrett
- License: MIT
- Used for: streaming decompression of local dsh Zstandard session logs on Node.js 20+.

## MIT License Text

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
