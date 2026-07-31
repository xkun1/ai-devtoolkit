# 🚀 doc2skill

> 将任意网页或 PDF 文档，1 秒转化为 AI Agent（Cursor / Codex / Claude）的专属技能包！

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green.svg)](https://nodejs.org/)
[![CI](https://github.com/xkun1/doc2skill/actions/workflows/ci.yml/badge.svg)](https://github.com/xkun1/doc2skill/actions)

---

## ✨ 它能做什么？

你有一堆 API 文档、SDK 指南、技术规范——每次让 AI 写代码都要手动粘贴。
**doc2skill** 自动把这些文档提炼成 AI Agent 能直接加载的技能包：

| 输入 | → | 输出 |
|------|:---:|------|
| 📄 网页 URL | → | 🤖 Codex `SKILL.md`（带 frontmatter） |
| 📕 PDF 文档 | → | 🎯 Cursor `.cursorrules` |
| 📝 Markdown | → | 🧠 Claude `CLAUDE.md` |
| 📚 多文档合并 | → | 🧩 一个融合技能包 |

## 🎬 快速开始

```bash
# 零安装直接用
npx doc2skill https://docs.example.com/api --type codex

# 从本地 PDF 生成 Cursor 规则
npx doc2skill ./sdk-guide.pdf --type cursor

# 从 Markdown 生成 Claude 项目记忆
npx doc2skill ./CONTRIBUTING.md --type claude

# 多文档合并为一个技能包
npx doc2skill ./api.md ./sdk.md ./errors.md --type codex

# 自定义技能名
npx doc2skill ./api.md --name my-api-spec

# stdout 模式：直接管道给其他工具
npx doc2skill ./api.md --stdout >> ./SKILL.md

# 无参数 → 交互式向导
npx doc2skill
```

### 🌐 Web UI 模式

```bash
# 启动本地 Web 界面（自动打开浏览器）
npx doc2skill --ui

# 自定义端口
npx doc2skill --ui --port 8080
```

在浏览器中粘贴 URL、选模板、实时预览生成结果，一键下载技能包文件。

### 🚀 进阶用法

```bash
# 爬取整个文档站点（自动发现子页面）
npx doc2skill https://docs.example.com --crawl --crawl-depth 2

# 监控模式：文档变更后自动刷新技能包
npx doc2skill ./api.md --watch

# 预览模式：只看结果不写文件
npx doc2skill ./api.md --dry-run
```

### 输出示例

```
╔══════════════════════════════════════╗
║   🚀 doc2skill — 文档转技能包        ║
╚══════════════════════════════════════╝

⠋ 正在加载文档...
✔ 加载完成: Stripe API Docs (28,431 字符)
⠋ 正在用 deepseek-chat 提炼技能知识...
✔ 提炼完成 (3,205 字符)
✓ 已生成: ./SKILL.md

  🎯 Agent: codex
  📄 文件: ./SKILL.md
  📏 大小: 3,205 字符
```

生成的 `SKILL.md` 自动注入 frontmatter：

```yaml
---
name: stripe-api-docs
description: "Stripe API Docs"
---

# Stripe API 技能指令
...
```

## 🔧 配置 LLM

doc2skill 兼容所有 **OpenAI 协议**的 API。内置常用模型预设：

| 模型 | 环境变量 | Base URL |
|------|---------|----------|
| `deepseek-chat` (默认) | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| `deepseek-reasoner` | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| `gpt-4o` | `OPENAI_API_KEY` | OpenAI 默认 |
| `gpt-4o-mini` | `OPENAI_API_KEY` | OpenAI 默认 |
| `doubao-pro-32k` | `ARK_API_KEY` | `ark.cn-beijing.volces.com/api/v3` |
| `ollama-local` 🦙 | 无需 API Key | `localhost:11434/v1` |
| `lmstudio-local` 🖥️ | 无需 API Key | `localhost:1234/v1` |

```bash
# 方式一：环境变量（推荐）
export DEEPSEEK_API_KEY="sk-xxxxx"
npx doc2skill https://docs.example.com/api

# 方式二：参数指定（或任何 OpenAI 兼容 API）
npx doc2skill <url> --api-key sk-xxx --base-url https://your-api.com/v1 --model your-model
```

### 🦙 本地模型（免费/离线）

使用 Ollama 或 LM Studio，完全本地运行，无需 API Key：

```bash
# Ollama（需先安装 ollama 并拉取模型）
npx doc2skill ./api.md --model ollama-local

# 自定义 Ollama 模型名（通过环境变量）
OLLAMA_MODEL=qwen2.5:7b npx doc2skill ./api.md --model ollama-local

# LM Studio
npx doc2skill ./api.md --model lmstudio-local
```

参考 `.env.example` 配置环境变量。

## 📖 CLI 完整参数

```
Usage: doc2skill [options] <sources...>

Arguments:
  sources              文档来源：URL 或本地文件路径（可多个，将合并为一个技能包）

Options:
  -t, --type <type>    目标 Agent: codex | cursor | claude (默认: codex)
  -o, --out <path>     输出文件路径 (默认: SKILL.md / .cursorrules / CLAUDE.md)
  -m, --model <model>  LLM 模型名 (默认: deepseek-chat)
  -n, --name <name>    自定义技能名（用于 Codex SKILL.md frontmatter）
  --stdout             输出到标准输出而不写文件（便于管道集成）
  --dry-run            预览生成结果，不写入文件
  --force              强制覆盖已存在的输出文件
  --ui                 启动 Web UI 界面（本地浏览器交互）
  --port <n>           Web UI 端口号（默认 3456）
  --crawl              爬取模式：自动发现并抓取文档站点子页面
  --crawl-depth <n>    爬取最大深度（默认 2）
  --crawl-pages <n>    爬取最大页面数（默认 10）
  -w, --watch          监控模式：文档变更后自动重新生成
  --template <id>      使用预设模板（api-doc / coding-guide / cheatsheet 等）
  --list-templates     列出所有可用模板
  --update             增量更新：跳过未变更的文档
  --base-url <url>     LLM API Base URL（覆盖预设）
  --api-key <key>      API Key（建议用环境变量）
  -v, --verbose        显示详细日志
  -V, --version        版本号
  -h, --help           帮助
```

也支持项目级配置文件 `.doc2skill.json`，CLI 参数优先覆盖配置文件值：

```json
{
  "type": "codex",
  "model": "deepseek-chat",
  "out": "./SKILL.md"
}
```

## 🏗️ 架构

```
Sources (URL/PDF/HTML/MD, 可多个)
  │
  ├── 🔌 Loader        按来源加载（并发）
  │   ├── URL         → fetch + cheerio 正文提取 + turndown 转 Markdown
  │   ├── PDF         → pdf-parse 文本提取
  │   ├── HTML        → 本地 HTML 文件正文提取
  │   └── File        → 本地文件直读
  │   └── merge       → 多文档带来源标签合并
  │
  ├── 🧠 Transform     LLM 智能提炼（内置指数退避重试）
  │   ├── Codex Prompt  → 结构化技能指令 + frontmatter
  │   ├── Cursor Prompt → 编码规则约束
  │   └── Claude Prompt → 项目记忆格式
  │
  ├── 📐 Format        格式化输出 + frontmatter 注入
  │
  └── 💾 Writer        写入文件 / stdout
```

**设计原则**：
- **单一职责** — 每个模块只做一件事
- **可扩展** — 新增 Agent 类型只需加一个 Prompt 模板
- **协议兼容** — 任何 OpenAI 兼容 API 即插即用
- **健壮性** — LLM 调用内置重试（429/5xx/网络错误，1s→2s→4s 退避，最多 3 次）
- **管道友好** — `--stdout` 模式支持与其他工具集成

## 🧪 测试

```bash
# 全套测试（49 个用例）
npm test

# 类型检查
npm run typecheck

# 构建
npm run build
```

测试覆盖：
- ✅ Loader：URL 正文提取 / PDF 解析 / 本地文件
- ✅ Transform：LLM 重试机制（mock OpenAI SDK）
- ✅ Format：slugify / frontmatter 注入 / 描述提取
- ✅ Pipeline：端到端编排（mock LLM）
- ✅ E2E：真实网页加载

## 📦 编程式 API

除了 CLI，doc2skill 也可作为 Node.js 库使用：

```typescript
import { doc2skill } from 'doc2skill';

const result = await doc2skill('https://docs.example.com/api', {
  agentType: 'codex',
  llm: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    model: 'deepseek-chat',
  },
});

console.log(result.content);       // 生成的内容
console.log(result.suggestedPath); // 建议输出路径
```

也支持只加载不提炼：

```typescript
import { loadDocument } from 'doc2skill';

const doc = await loadDocument('https://example.com');
console.log(doc.content); // 提取的 Markdown
```

完整 API 文档见 `examples/` 目录。

## 🔨 本地开发

```bash
git clone https://github.com/xkun1/doc2skill.git
cd doc2skill
npm install

# 开发模式
npm run dev -- <url> --type codex

# 构建
npm run build

# 测试
npm test
```

## 🗺️ 路线图

- [x] 网页 URL 正文提取
- [x] PDF 文档解析
- [x] Codex / Cursor / Claude 三种输出
- [x] DeepSeek / OpenAI / 火山方舟 预设
- [x] 多文档合并（一个技能包融合多个来源）
- [x] Codex SKILL.md frontmatter 自动注入
- [x] LLM 调用重试机制（指数退避）
- [x] stdout 模式（管道集成）
- [x] 自定义技能名
- [x] CI（GitHub Actions，多 Node 版本矩阵）
- [x] 交互式向导（无参数运行 `npx doc2skill` 进入 inquirer 引导）
- [x] 编程式 API（可作为 Node.js 库 import）
- [x] dry-run 预览模式
- [x] 覆盖保护（--force）
- [x] 配置文件（.doc2skill.json 项目级默认值）
- [x] 本地 HTML 文件支持
- [x] 文档站点爬取（--crawl 自动发现子页面）
- [x] Token 预估与费用提示
- [x] watch 模式（文档变更自动刷新）
- [x] 技能包模板市场（6 套内置模板：api-doc / coding-guide / cheatsheet 等）
- [x] 增量更新（--update 检测文档 hash，跳过未变更内容）
- [x] Web UI 界面（--ui 浏览器可视化交互）

## 📄 License

MIT License © 2026 [kun](https://github.com/xkun1)
