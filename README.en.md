# 🚀 devtoolkit

> Turn any webpage or PDF into an AI Agent skill pack (Cursor / Codex / Claude) — in seconds!

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.19-green.svg)](https://nodejs.org/)
[![CI](https://github.com/xkun1/devtoolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/xkun1/devtoolkit/actions)

**[简体中文](README.md) | English**

---

## ✨ What Does It Do?

You have a pile of API docs, SDK guides, and technical specs — every time you ask AI to write code, you manually paste them in.
**devtoolkit** automatically distills these documents into skill packs that AI Agents can load directly:

| Input | → | Output |
|-------|:---:|-------|
| 📄 Web URL | → | 🤖 Codex `.agents/skills/<name>/SKILL.md` |
| 📕 PDF Document | → | 🎯 Cursor `.cursor/rules/<name>.mdc` |
| 📝 Markdown | → | 🧠 Claude `CLAUDE.md` + `.claude/rules/` (when long) |
| 📚 Multi-doc Merge | → | 🧩 Fused skill pack after chunked extraction |
| 📂 Batch Directory | → | 🤖 One skill pack per file (or `--merge` to combine) |
| 🔌 MCP Server | → | 🤖 Native tool call for AI Agents |

## 🎬 Quick Start

```bash
# Zero-install, run directly
npx ai-devtoolkit https://docs.example.com/api --type codex

# Generate Cursor rules from a local PDF
npx ai-devtoolkit ./sdk-guide.pdf --type cursor

# Generate Claude project memory from Markdown
npx ai-devtoolkit ./CONTRIBUTING.md --type claude

# Merge multiple documents into one skill pack
npx ai-devtoolkit ./api.md ./sdk.md ./errors.md --type codex

# Custom skill name
npx ai-devtoolkit ./api.md --name my-api-spec

# stdout mode: pipe directly to other tools
npx ai-devtoolkit ./api.md --stdout >> ./SKILL.md

# No arguments → interactive wizard
npx ai-devtoolkit
```

### 🌐 Web UI Mode

```bash
# Launch local web interface (auto-opens browser)
npx ai-devtoolkit --ui

# Custom port
npx ai-devtoolkit --ui --port 8080
```

Paste a URL, choose a template, preview results in real time, and download a complete ZIP skill pack with one click. Codex `references/` and Claude `.claude/rules/` multi-file directories are fully preserved.

The Web UI only listens on `127.0.0.1` and only accepts public HTTP(S) URLs or browser-uploaded content. It never reads arbitrary server-side local paths. Upload requests are limited to 10 MiB by default, and remote documents to 5 MiB.

### 🔌 MCP Server Mode

Make devtoolkit a native tool for AI Agents — via the MCP protocol, Agents can directly invoke document-to-skill capabilities:

```bash
# Start MCP Server (stdio JSON-RPC)
npx ai-devtoolkit --mcp
```

**Claude Desktop config** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "devtoolkit": {
      "command": "npx",
      "args": ["devtoolkit", "--mcp"],
      "env": {
        "DEEPSEEK_API_KEY": "sk-xxx"
      }
    }
  }
}
```

**Cursor config** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "devtoolkit": {
      "command": "npx",
      "args": ["devtoolkit", "--mcp"]
    }
  }
}
```

The MCP Server provides 2 tools:

| Tool | Description |
|------|-------------|
| `generate_skill` | Convert documents/URLs into AI Agent skill packs (supports batch directories) |
| `scan_directory` | Scan a directory and return a list of supported document files |

#### Using Local Models (Ollama / LM Studio)

Local models require no API Key — specify model info via environment variables or CLI args:

**Option 1: Environment Variables** (recommended, simplest)

```json
{
  "mcpServers": {
    "devtoolkit": {
      "command": "npx",
      "args": ["devtoolkit", "--mcp", "--model", "ollama-local"],
      "env": {
        "OLLAMA_MODEL": "qwen2.5-coder:7b"
      }
    }
  }
}
```

**Option 2: CLI Args** (fix the model at startup — no need to pass it per call)

```json
{
  "mcpServers": {
    "devtoolkit": {
      "command": "npx",
      "args": [
        "devtoolkit", "--mcp",
        "--model", "ollama-local",
        "--local-model", "qwen2.5-coder:7b"
      ]
    }
  }
}
```

**Option 3: Custom Local Service** (vLLM / Xinference / any OpenAI-compatible API)

```json
{
  "mcpServers": {
    "devtoolkit": {
      "command": "npx",
      "args": [
        "devtoolkit", "--mcp",
        "--model", "custom-local",
        "--base-url", "http://localhost:8000/v1",
        "--local-model", "my-model-name"
      ]
    }
  }
}
```

> **Environment Variable Reference**:
> | Variable | Purpose |
> |----------|---------|
> | `OLLAMA_MODEL` | Ollama model name (e.g. `qwen2.5-coder:7b`) |
> | `LMSTUDIO_MODEL` | LM Studio model name |
> | `LOCAL_MODEL_NAME` | Any local model name (universal fallback) |
> | `DEEPSEEK_API_KEY` | DeepSeek API Key (cloud models) |
> | `OPENAI_API_KEY` | OpenAI API Key (cloud models) |

### 🚀 Advanced Usage

```bash
# Crawl an entire documentation site (auto-discover sub-pages)
npx ai-devtoolkit https://docs.example.com --crawl --crawl-depth 2

# Batch process an entire directory (one skill pack per file)
npx ai-devtoolkit ./docs/ --type codex

# Directory merge mode: combine all files into one skill pack
npx ai-devtoolkit ./docs/ --type codex --merge

# Control directory scan depth
npx ai-devtoolkit ./docs/ --type codex --dir-depth 3

# Watch mode: auto-refresh skill pack on document change
npx ai-devtoolkit ./api.md --watch

# Preview mode: see results without writing files
npx ai-devtoolkit ./api.md --dry-run

# Legacy workflow: single-file output (SKILL.md / .cursorrules / CLAUDE.md)
npx ai-devtoolkit ./api.md --type cursor --legacy
```

Inputs exceeding ~24K characters are semantically chunked by Markdown structure, then processed through "per-chunk extraction → hierarchical merge → final synthesis." No silent mid-document truncation. Codex overflow automatically sinks to `references/`; Claude overflow splits into `.claude/rules/`.

### Output Example

```
╔══════════════════════════════════════╗
║   🚀 devtoolkit — Docs → Skill Pack   ║
╚══════════════════════════════════════╝

⠋ Loading document...
✔ Loaded: Stripe API Docs (28,431 chars)
⠋ Extracting skill knowledge with deepseek-chat...
✔ Extraction complete (3,205 chars)
✓ Generated: .agents/skills/stripe-api-docs/SKILL.md

  🎯 Agent: codex
  📦 Files: 1
  ✅ Quality: 100/100
```

The generated `SKILL.md` auto-injects frontmatter:

```yaml
---
name: stripe-api-docs
description: "Stripe API Docs"
---

# Stripe API Skill Instructions
...
```

## 🔧 LLM Configuration

devtoolkit is compatible with all **OpenAI-protocol** APIs. Built-in model presets:

| Model | Env Variable | Base URL |
|-------|-------------|----------|
| `deepseek-chat` (default) | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| `deepseek-reasoner` | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| `gpt-4o` | `OPENAI_API_KEY` | OpenAI default |
| `gpt-4o-mini` | `OPENAI_API_KEY` | OpenAI default |
| `doubao-pro-32k` | `ARK_API_KEY` | `ark.cn-beijing.volces.com/api/v3` |
| `ollama-local` 🦙 | No API Key needed | `localhost:11434/v1` |
| `lmstudio-local` 🖥️ | No API Key needed | `localhost:1234/v1` |

```bash
# Option 1: Environment variable (recommended)
export DEEPSEEK_API_KEY="sk-xxxxx"
npx ai-devtoolkit https://docs.example.com/api

# Option 2: CLI args (or any OpenAI-compatible API)
npx ai-devtoolkit <url> --api-key sk-xxx --base-url https://your-api.com/v1 --model your-model
```

### 🦙 Local Models (Free / Offline)

Run entirely locally with Ollama or LM Studio — no API Key required:

```bash
# Ollama (install ollama and pull a model first)
npx ai-devtoolkit ./api.md --model ollama-local

# Custom Ollama model name (via environment variable)
OLLAMA_MODEL=qwen2.5:7b npx ai-devtoolkit ./api.md --model ollama-local

# Explicitly specify the local model name via CLI arg
npx ai-devtoolkit ./api.md --model ollama-local --local-model qwen2.5:7b

# LM Studio
npx ai-devtoolkit ./api.md --model lmstudio-local
```

See `.env.example` for environment variable configuration.

## 📖 CLI Reference

```
Usage: devtoolkit [options] <sources...>

Arguments:
  sources              Document sources: URLs or local file paths (multiple allowed, merged into one skill pack)

Options:
  -t, --type <type>    Target Agent: codex | cursor | claude (default: codex)
  -o, --out <path>     Custom output file path (default: Agent-recommended directory)
  -m, --model <model>  LLM model name (default: deepseek-chat)
  -n, --name <name>    Custom skill name (for Codex SKILL.md frontmatter)
  --stdout             Output to stdout instead of writing files (for pipe integration)
  --dry-run            Preview results without writing files
  --force              Force overwrite existing output files
  --ui                 Launch Web UI interface (local browser interaction)
  --port <n>           Web UI port number (default: 3456)
  --mcp                Start MCP Server (stdio JSON-RPC for AI Agent integration)
  --crawl              Crawl mode: auto-discover and fetch documentation sub-pages
  --crawl-depth <n>    Max crawl depth (default: 2)
  --crawl-pages <n>    Max pages to crawl (default: 10)
  --merge              Directory mode: merge all files into one skill pack
  --dir-depth <n>      Max directory scan depth (default: 5)
  -w, --watch          Watch mode: auto-regenerate on document change
  --template <id>      Use a preset template (api-doc / coding-guide / cheatsheet, etc.)
  --list-templates     List all available templates
  --update             Incremental update: skip unchanged documents
  --legacy             Output legacy single-file structure
  --base-url <url>     LLM API Base URL (overrides preset)
  --api-key <key>      API Key (prefer environment variables)
  --local-model <name> Real model name in local service
  -v, --verbose        Show detailed logs
  -V, --version        Print version
  -h, --help           Show help
```

Also supports project-level config file `.devtoolkit.json`. CLI args take precedence:

```json
{
  "type": "codex",
  "model": "deepseek-chat",
  "outputMode": "modern"
}
```

## 🏗️ Architecture

```
Sources (URL/PDF/HTML/MD, multiple allowed)
  │
  ├── 🔌 Loader        Load by source type (concurrent)
  │   ├── URL         → fetch + cheerio text extraction + turndown to Markdown
  │   ├── PDF         → pdf-parse text extraction
  │   ├── HTML        → Local HTML file text extraction
  │   └── File        → Direct local file read
  │   └── merge       → Multi-document merge with source labels
  │
  ├── 🧠 Transform     Full chunked extraction + hierarchical merge (built-in retry w/ backoff)
  │   ├── Codex Prompt  → Structured skill instructions + frontmatter
  │   ├── Cursor Prompt → Coding rule constraints
  │   └── Claude Prompt → Project memory format
  │
  ├── 📐 Format        Agent-native directories + frontmatter + progressive disclosure
  │
  ├── ✅ Quality       Format, metadata, length, and duplication validation
  │
  └── 💾 Writer        Atomic writes / full-fingerprint caching / stdout
```

**Design Principles**:
- **Single Responsibility** — Each module does one thing
- **Extensible** — Adding a new Agent type only requires a new prompt template
- **Protocol Compatible** — Any OpenAI-compatible API works out of the box
- **Robustness** — Built-in LLM call retry (429/5xx/network errors, 1s→2s→4s backoff, up to 3 retries)
- **Pipe-Friendly** — `--stdout` mode for integration with other tools

## 🧪 Testing

```bash
# Full test suite
npm test

# Type checking
npm run typecheck

# Build
npm run build
```

Test coverage:
- ✅ Loader: URL text extraction / PDF parsing / local files
- ✅ Transform: LLM retry mechanism (mock OpenAI SDK)
- ✅ Long documents: lossless chunking / concurrent extraction / hierarchical synthesis
- ✅ Format: slugify / frontmatter injection / description extraction
- ✅ Modern output: Codex skill directories / Cursor MDC / Claude Rules
- ✅ Quality baseline and real-artifact incremental caching
- ✅ Pipeline: end-to-end orchestration (mock LLM)
- ✅ E2E: real webpage loading

## 📦 Programmatic API

Beyond the CLI, devtoolkit can be used as a Node.js library:

```typescript
import { devtoolkit } from 'ai-devtoolkit';

const result = await devtoolkit('https://docs.example.com/api', {
  agentType: 'codex',
  llm: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
  },
});

console.log(result.content);       // Generated content
console.log(result.suggestedPath); // Suggested output path
console.log(result.artifacts);     // Full file list (including references/rules)
console.log(result.quality);       // Static quality report
console.log(result.stats);         // Chunking, LLM calls, and cache stats
```

Also supports load-only without extraction:

```typescript
import { loadDocument } from 'ai-devtoolkit';

const doc = await loadDocument('https://example.com');
console.log(doc.content); // Extracted Markdown
```

See the `examples/` directory for complete API documentation.

## 🔨 Local Development

```bash
git clone https://github.com/xkun1/devtoolkit.git
cd devtoolkit
npm install

# Development mode
npm run dev -- <url> --type codex

# Build
npm run build

# Test
npm test
```

## 🗺️ Roadmap

- [x] Web URL text extraction
- [x] PDF document parsing
- [x] Codex / Cursor / Claude output formats
- [x] DeepSeek / OpenAI / Volcengine Ark presets
- [x] Multi-document merge (fuse multiple sources into one skill pack)
- [x] Codex SKILL.md frontmatter auto-injection
- [x] LLM call retry mechanism (exponential backoff)
- [x] stdout mode (pipe integration)
- [x] Custom skill names
- [x] CI (GitHub Actions, multi-Node version matrix)
- [x] Interactive wizard (run `npx ai-devtoolkit` with no args for inquirer-guided setup)
- [x] Programmatic API (usable as a Node.js library)
- [x] dry-run preview mode
- [x] Overwrite protection (--force)
- [x] Config file (.devtoolkit.json project-level defaults)
- [x] Local HTML file support
- [x] Documentation site crawling (--crawl auto-discovers sub-pages)
- [x] Token estimation and cost hints
- [x] Watch mode (auto-refresh on document change)
- [x] Skill pack template marketplace (6 built-in templates: api-doc / coding-guide / cheatsheet, etc.)
- [x] Incremental updates (--update with full generation fingerprint + real-artifact verification)
- [x] Web UI interface (--ui browser-based visual interaction)
- [x] Long document lossless chunking, hierarchical merge, and source coverage stats
- [x] Codex / Cursor / Claude current recommended directory structures (--legacy to revert)
- [x] Full generation fingerprint, real-artifact cache reuse, and atomic writes
- [x] Static validation and quality scoring of generated results
- [x] MCP Server mode (--mcp for AI Agent native tool integration)
- [x] Batch directory processing (auto-scan dirs, --merge to combine)

## 📄 License

MIT License © 2026 [kun](https://github.com/xkun1)
