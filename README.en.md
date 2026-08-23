# 🚀 devtoolkit

> Turn webpages, PDFs, OpenAPI specs, and local docs into skill packs for seven AI Agents.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fxkun1%2Fai-devtoolkit%2Fmain%2Fpackage.json&query=%24.devDependencies.typescript&label=TypeScript&color=blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20.19-green.svg)](https://nodejs.org/)
[![CI](https://github.com/xkun1/ai-devtoolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/xkun1/ai-devtoolkit/actions)

**[简体中文](README.md) | English**

---

## ✨ What Does It Do?

You have a pile of API docs, SDK guides, and technical specs — every time you ask AI to write code, you manually paste them in.
**devtoolkit** automatically distills these documents into skill packs that AI Agents can load directly:

| Input | → | Output |
|-------|:---:|-------|
| 📄 Web URL | → | 🤖 Codex `.agents/skills/<name>/SKILL.md` |
| 📕 PDF Document | → | 🎯 Cursor `.cursor/rules/<name>.mdc` |
| ⚡️ Swagger / OpenAPI Spec | → | 🛠️ Structured API Skillpack (Saves 80%~90% Tokens, [Benchmark](https://github.com/xkun1/ai-devtoolkit/blob/main/docs/benchmark.md)) |
| 📝 Markdown | → | 🧠 Claude `.claude/skills/<name>/SKILL.md` |
| 📚 Multi-doc Merge | → | 🧩 Fused skill pack after chunked extraction |
| 📂 Batch Directory | → | 🤖 One skill pack per file (or `--merge` to combine) |
| 🔌 MCP Server | → | 🤖 Native tool call for AI Agents |
| 🧭 Seven Agents | → | Codex / Cursor / Claude / Windsurf / Copilot / Gemini / Aider |

## 🎬 Quick Start

![devtoolkit demo](https://raw.githubusercontent.com/xkun1/ai-devtoolkit/main/docs/assets/demo.gif)

```bash
# Zero-install, run directly
npx ai-devtoolkit https://docs.example.com/api --type codex

# Generate Cursor rules from a local PDF
npx ai-devtoolkit ./sdk-guide.pdf --type cursor

# Generate a Claude Agent Skill from Markdown
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

### 🔄 Cross-Agent Rule Conversion & Sync (All Seven Agents)

Convert rules between Cursor, Codex, and Claude seamlessly in any project:

```bash
# 1. Single file: Convert Cursor rule to Codex skill
devtoolkit --convert .cursor/rules/api.mdc --type codex

# 2. Convert a Claude Skill to a Cursor rule
devtoolkit --convert .claude/skills/project-guide/SKILL.md --type cursor

# 3. One-click full-project sync (auto-discovers existing rules and syncs across agents)
devtoolkit --sync

# 4. Preview sync plan only (dry-run)
devtoolkit --sync --dry-run
```

Supported targets: Codex, Cursor, Claude, Windsurf, GitHub Copilot, Gemini CLI, and Aider.

### ✅ Agent Skills Standard and Validation

Generation and rule conversion now share one canonical Skill IR. Platforms implementing the [Agent Skills specification](https://agentskills.io/specification) use native skill directories by default:

| Platform | Default modern output |
| --- | --- |
| Codex | `.agents/skills/<name>/SKILL.md` |
| Claude Code | `.claude/skills/<name>/SKILL.md` |
| GitHub Copilot | `.github/skills/<name>/SKILL.md` |
| Gemini CLI | `.gemini/skills/<name>/SKILL.md` |

Validate one Skill or every Skill in a project:

```bash
# Validate a directory or SKILL.md
devtoolkit validate .agents/skills/my-skill

# Scan the project and fail on warnings too
devtoolkit validate . --strict

# Machine-readable CI output
devtoolkit validate . --json
```

Validation covers name/description constraints, parent-directory naming, YAML types, the 500-line progressive-disclosure recommendation, local-reference existence, and path boundaries.

### 🌐 Web UI Mode

```bash
# Launch local web interface (auto-opens browser)
npx ai-devtoolkit --ui

# Custom port
npx ai-devtoolkit --ui --port 8080
```

Paste a URL, choose a template, preview results in real time, and download a complete ZIP skill pack with one click. Native Agent Skill multi-file directories such as `references/` are fully preserved.

The Web UI only listens on `127.0.0.1` and only accepts public HTTP(S) URLs or browser-uploaded content. Code search, graph, and source viewing are confined to the project root fixed at startup, including symlink checks. Upload requests default to 10 MiB, remote documents to 5 MiB, and source viewing to 2 MiB per file.

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
      "args": ["-y", "ai-devtoolkit", "--mcp"],
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
      "args": ["-y", "ai-devtoolkit", "--mcp"]
    }
  }
}
```

The MCP Server provides 9 tools. Its stdout is JSON-RPC only; logs are written to stderr:

| Tool | Description |
|------|-------------|
| `generate_skill` | Convert documents/URLs into AI Agent skill packs (supports batch directories) |
| `scan_directory` | Scan a directory and return a list of supported document files |
| `scan_code` | Build a local project code index |
| `search_code` | Search code with natural language and optional LLM explanation |
| `convert_rule` | Convert rules between Cursor, Codex, and Claude formats |
| `sync_rules` | Preview or synchronize project Agent rules |
| `export_env` | Export an environment snapshot and restore script |
| `diff_env` | Compare a snapshot with the current machine |
| `eval_skill` | Run skill-vs-baseline evaluation |

#### Using Local Models (Ollama / LM Studio)

Local models require no API Key — specify model info via environment variables or CLI args:

**Option 1: Environment Variables** (recommended, simplest)

```json
{
  "mcpServers": {
    "devtoolkit": {
      "command": "npx",
      "args": ["-y", "ai-devtoolkit", "--mcp", "--model", "ollama-local"],
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
        "-y", "ai-devtoolkit", "--mcp",
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
        "-y", "ai-devtoolkit", "--mcp",
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

# Force output language and choose the sensitive-data policy
npx ai-devtoolkit ./api.md --lang en --sensitive-policy error

# Select a code-search strategy
npx ai-devtoolkit --search "authentication" --search-mode exact

# Generate a pinned, injection-safe scheduled refresh workflow
npx ai-devtoolkit https://docs.example.com/api --generate-refresh-workflow

# Lifecycle, diagnostics, and project summary
npx ai-devtoolkit --list-skills
npx ai-devtoolkit --remove-skill my-skill
npx ai-devtoolkit --doctor
npx ai-devtoolkit ./my-project --repo-map
```

Inputs exceeding ~24K characters are semantically chunked by Markdown structure, then processed through "per-chunk extraction → hierarchical merge → final synthesis." No silent mid-document truncation. Long native Agent Skills automatically move details into `references/` to keep `SKILL.md` progressively disclosed.

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
Usage: devtoolkit [options] [command] [sources...]

Arguments:
  sources              Document sources: URLs or local file paths (multiple allowed, merged into one skill pack)

Options:
  -t, --type <type>    Target: codex | cursor | claude | windsurf | copilot | gemini | aider
  -o, --out <path>     Custom output file path (default: Agent-recommended directory)
  -m, --model <model>  LLM model name (default: deepseek-chat)
  -n, --name <name>    Custom skill name (for Agent Skills frontmatter)
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
  --lang <lang>        Output language: zh | en | auto
  --sensitive-policy <policy> Sensitive-data policy: redact | error | off
  --convert <file>     Convert a rule file to the target Agent format
  --sync               Discover and synchronize project Agent rules
  --sync-from <agent>  Source Agent (default: auto)
  --sync-to <agents>   Comma-separated target Agents
  --eval <skillFile>   Run automated skill-vs-baseline evaluation
  --scan-code          Scan project code and build a search index
  --search <query>     Search project code with natural language
  --search-mode <mode> Search mode: hybrid | exact | semantic
  --no-explain         Disable LLM explanations for search results
  --graph              Generate a Mermaid dependency graph
  --no-cache           Disable incremental dependency-graph cache
  --impact <file>      Analyze the change impact of a file
  --repo-map           Generate a project structure summary
  --doctor             Diagnose runtime and project health
  --list-skills        List registered skill packs
  --remove-skill <name> Safely remove a registered skill pack
  --generate-refresh-workflow Generate a scheduled GitHub Actions workflow
  --env-export         Export an environment snapshot and restore script
  --env-import <file>  Import an environment snapshot (preview by default)
  --env-diff <file>    Compare a snapshot with the current machine
  --execute            Execute installation commands for --env-import
  -v, --verbose        Show detailed logs
  -V, --version        Print version
  -h, --help           Show help

Commands:
  validate [path]      Validate a Skill directory, SKILL.md, or all project Skills
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
  │   ├── Claude Prompt → Project memory format
  │   └── Generic Prompt → Windsurf / Copilot / Gemini / Aider rules
  │
  ├── 📐 Format        Agent-native directories + frontmatter + progressive disclosure
  │
  ├── ✅ Quality       Format, metadata, length, and duplication validation
  │
  └── 💾 Writer        Preflight, atomic replacement, rollback / full-fingerprint caching / stdout
```

**Design Principles**:
- **Single Responsibility** — Each module does one thing
- **Extensible** — Adding a new Agent type only requires a new prompt template
- **Protocol Compatible** — Any OpenAI-compatible API works out of the box
- **Robustness** — Built-in LLM call retry (429/5xx/network errors, 1s→2s→4s backoff, up to 3 retries)
- **Secure by Default** — Redacts secrets, confines generated/deleted paths to the project, and rolls back failed multi-file writes
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

For lightweight use cases, import `ai-devtoolkit/search` or `ai-devtoolkit/security` without loading the full toolkit.

Also supports load-only without extraction:

```typescript
import { loadDocument } from 'ai-devtoolkit';

const doc = await loadDocument('https://example.com');
console.log(doc.content); // Extracted Markdown
```

See the `examples/` directory for complete API documentation.

## 🔨 Local Development

```bash
git clone https://github.com/xkun1/ai-devtoolkit.git
cd devtoolkit
npm install

# Development mode
npm run dev -- <url> --type codex

# Build
npm run build

# Test
npm test
```


## 📄 License

MIT License © 2026 [kun](https://github.com/xkun1)
