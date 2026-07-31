# 🚀 doc2skill

> 将任意网页或 PDF 文档，1 秒转化为 AI Agent（Cursor / Codex / Claude）的专属技能包！

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D18-green.svg)](https://nodejs.org/)

---

## ✨ 它能做什么？

你有一堆 API 文档、SDK 指南、技术规范——每次让 AI 写代码都要手动粘贴。
**doc2skill** 自动把这些文档提炼成 AI Agent 能直接加载的技能包：

| 输入 | → | 输出 |
|------|:---:|------|
| 📄 网页 URL | → | 🤖 Codex `SKILL.md` |
| 📕 PDF 文档 | → | 🎯 Cursor `.cursorrules` |
| 📝 Markdown | → | 🧠 Claude `CLAUDE.md` |

## 🎬 快速开始

```bash
# 零安装直接用
npx doc2skill https://docs.example.com/api --type codex

# 从本地 PDF 生成 Cursor 规则
npx doc2skill ./sdk-guide.pdf --type cursor

# 从 Markdown 生成 Claude 项目记忆
npx doc2skill ./CONTRIBUTING.md --type claude
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

## 🔧 配置 LLM

doc2skill 兼容所有 **OpenAI 协议**的 API。内置常用模型预设：

| 模型 | 环境变量 | Base URL |
|------|---------|----------|
| `deepseek-chat` (默认) | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| `deepseek-reasoner` | `DEEPSEEK_API_KEY` | `api.deepseek.com/v1` |
| `gpt-4o` | `OPENAI_API_KEY` | OpenAI 默认 |
| `gpt-4o-mini` | `OPENAI_API_KEY` | OpenAI 默认 |
| `doubao-pro-32k` | `ARK_API_KEY` | `ark.cn-beijing.volces.com/api/v3` |

```bash
# 方式一：环境变量（推荐）
export DEEPSEEK_API_KEY="sk-xxxxx"
npx doc2skill https://docs.example.com/api

# 方式二：参数指定（或任何 OpenAI 兼容 API）
npx doc2skill <url> --api-key sk-xxx --base-url https://your-api.com/v1 --model your-model
```

## 📖 CLI 完整参数

```
Usage: doc2skill [options] <source>

Arguments:
  source               文档来源：URL 或本地文件路径

Options:
  -t, --type <type>    目标 Agent: codex | cursor | claude (默认: codex)
  -o, --out <path>     输出文件路径 (默认: SKILL.md / .cursorrules / CLAUDE.md)
  -m, --model <model>  LLM 模型名 (默认: deepseek-chat)
  --base-url <url>     LLM API Base URL（覆盖预设）
  --api-key <key>      API Key（建议用环境变量）
  -v, --verbose        显示详细日志
  -V, --version        版本号
  -h, --help           帮助
```

## 🏗️ 架构

```
Source (URL/PDF/MD)
  │
  ├── 🔌 Loader        按来源加载
  │   ├── URL         → fetch + cheerio 正文提取 + turndown 转 Markdown
  │   ├── PDF         → pdf-parse 文本提取
  │   └── File        → 本地文件直读
  │
  ├── 🧠 Transform     LLM 智能提炼
  │   ├── Codex Prompt  → 结构化技能指令
  │   ├── Cursor Prompt → 编码规则约束
  │   └── Claude Prompt → 项目记忆格式
  │
  ├── 📐 Format        格式化输出
  │
  └── 💾 Writer        写入文件
```

**设计原则**：
- **单一职责** — 每个模块只做一件事
- **可扩展** — 新增 Agent 类型只需加一个 Prompt 模板
- **协议兼容** — 任何 OpenAI 兼容 API 即插即用

## 🔨 本地开发

```bash
git clone https://github.com/kun-labs/doc2skill.git
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
- [ ] 多文档合并（一个技能包融合多个来源）
- [ ] 交互式模式（inquirer 选择）
- [ ] 技能包模板市场
- [ ] 增量更新（检测文档变更后刷新技能）

## 📄 License

MIT License © 2026 [kun](https://github.com/kun-labs)
