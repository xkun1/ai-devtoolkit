## Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [0.6.1] — 2026-07-31

### 新功能

- **本地模型支持**：新增 Ollama 和 LM Studio 预设，免费/离线运行
- 本地模型自动跳过 API Key 检查
- 统一模型注册表（src/models.ts），CLI / Wizard / Web UI 共用
- Web UI 选择本地模型时自动隐藏 API Key 输入框
- 环境变量自定义本地模型名（OLLAMA_MODEL / LMSTUDIO_MODEL）

## [0.6.0] — 2026-07-31

### 新功能

- **Web UI 界面**：`--ui` 启动本地浏览器可视化界面，粘贴 URL → 选模板 → 实时预览 → 一键下载
- 零依赖内嵌 HTTP 服务器（不依赖 express）
- 暗色主题单页应用，支持生成预览、复制、下载
- `--port` 自定义端口（默认 3456）
- 自动打开浏览器

## [0.5.0] — 2026-07-31

### 新功能

- **技能包模板市场**：内置 6 套模板（api-doc / coding-guide / project-rules / cheatsheet / sdk-guide / default）
- **增量更新**：`--update` 用内容 hash 检测文档变更，跳过未变更的 LLM 调用
- **`--list-templates`**：列出所有可用模板
- **`--template <id>`**：选择预设模板，不同文档类型使用不同提炼策略

### 改进

- 测试增强至 91 个用例（新增 templates / hash 测试）
- 编程式 API 导出模板和 hash 工具
- `.doc2skill-cache.json` 缓存增量更新状态

## [0.4.0] — 2026-07-31

### 新功能

- **文档站点爬取**：`--crawl` 自动发现并抓取子页面，BFS 遍历合并为完整技能包
- **Token 预估**：LLM 调用前显示输入 token 数和预计费用
- **watch 模式**：`-w / --watch` 监控源文档变更，自动重新生成技能包
- **爬取控制**：`--crawl-depth` / `--crawl-pages` 控制深度和数量

### 改进

- 测试增强至 75 个用例（新增 crawler / token estimate 测试）
- crawler 每页只 fetch 一次（同时提取正文和链接）

## [0.3.0] — 2026-07-31

### 新功能

- **编程式 API**：可作为 Node.js 库使用（`import { doc2skill } from 'doc2skill'`），双入口构建（CLI + lib）
- **dry-run 预览模式**：`--dry-run` 只查看生成结果不写文件
- **覆盖保护**：文件已存在时拒绝覆盖，`--force` 强制覆盖
- **配置文件支持**：`.doc2skill.json` 项目级默认值，CLI 参数优先覆盖
- **本地 HTML 文件**：`.html` / `.htm` 文件走 cheerio + turndown 正文提取管线
- **examples 目录**：编程式 API 示例 + CLI 快速参考 + 样例文档

### 改进

- tsup 双入口构建（index CLI + lib 编程式 API）
- package.json exports 字段支持子路径导入
- 测试增强至 60 个用例（新增 config / dry-run / 覆盖保护 / HTML loader 测试）

## [0.2.0] — 2026-07-31

### 新功能

- **交互式向导**：无参数运行 `npx doc2skill` 进入引导问答，逐步选择来源/类型/模型
- **多文档合并**：支持传入多个来源，合并提炼为一个技能包
- **stdout 模式**：`--stdout` 输出到标准输出，便于管道集成
- **自定义技能名**：`--name` 指定 Codex SKILL.md frontmatter 中的技能名
- **Codex frontmatter 自动注入**：`name` + `description` YAML frontmatter
- **LLM 指数退避重试**：429/5xx/网络错误自动重试 3 次

### 工程化

- GitHub Actions CI（Node 18/20/22 矩阵）
- ESLint + Prettier + Husky + lint-staged
- CONTRIBUTING + Issue/PR 模板
- prepublishOnly 发布前校验

## [0.1.0] — 2026-07-31

### 首次发布

- 网页 URL 正文提取（fetch + cheerio + turndown）
- PDF 文档解析（pdf-parse）
- Codex `SKILL.md` / Cursor `.cursorrules` / Claude `CLAUDE.md` 三种输出
- DeepSeek / OpenAI / 火山方舟 等 OpenAI 协议 API 兼容
- 内置模型预设，零配置开箱即用
- TypeScript 严格模式 + tsup 构建 + vitest 测试
