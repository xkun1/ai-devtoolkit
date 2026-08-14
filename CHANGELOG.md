## Changelog

本项目遵循 [Semantic Versioning](https://semver.org/)。

## [未发布]

### 修复与加固

- 修复 CLI 爬取、目录合并、`--no-explain` 与配置文件默认值未正确传入的问题；目录批量模式恢复默认覆盖保护。
- MCP Server 同步包版本，补齐 `eval_skill`，严格隔离 stdout 日志，并加强 JSON-RPC 与工具参数校验。
- 环境快照导入改用无 Shell 的参数化执行，增加结构校验、命令注入防护与 0600/0700 文件权限。
- 统一远程网页、爬虫和 OpenAPI 的公网安全抓取；OpenAPI YAML 改用标准解析器。
- Web UI 固定项目根目录边界，阻止路径与符号链接逃逸，限制源码大小并转义动态 HTML；规则同步增加 dry-run 与二次确认。
- 技能评测真正纳入无技能基线评分、增益指标、独立裁判提示词与有界并发。

## [0.9.0] — 2026-08-14

### 新功能

- **📊 技能自动化效果评测 (Skill Eval)**：为任意 AI 技能包自动生成 Benchmark 测试集，执行严格对照评测并输出量化报告
  - 测试用例自动提炼：根据技能内容智能提取触发问题（Query）、期望关键词（Expected Keywords）、核心结论与评分准则（Rubric）
  - 对照实验打分：对比带技能规则与无技能基线的模型表现，计算触发命中率、准确率与综合评级（S/A/B/C/D）
  - 改进建议生成：自动指出技能规则中的模糊表述与易漏点，给出精准优化建议
  - CLI & MCP 支持：`devtoolkit --eval <skill.md>` 及 MCP 工具 `eval_skill`

- **📈 代码依赖架构图谱与改动影响面分析 (Graph & Impact)**：静态解析项目依赖拓扑，推演改动波及链路
  - 依赖拓扑图谱：静态扫描 TypeScript、JavaScript、Python 等多语言 import/export 语句，输出 Mermaid 架构拓扑图（`devtoolkit --graph`）
  - 改动影响面推演：基于反向依赖图谱执行 BFS 拓扑遍历，递归追溯修改指定文件受影响的所有直接与间接上游链路（`devtoolkit --impact <file>`）
  - 风险评级：根据波及节点深度与广度评估风险级别（Low / Medium / High / Critical）

- **🌐 五合一极简 Web 开发者工作台**：全景化升级 Web 仪表盘
  - 包含【📄 技能工坊】、【🔄 规则互转】、【🔍 代码搜索】、【📈 架构图谱】、【📦 环境资产】五大面板
  - 支持在网页中一键评测技能包效果、一键转换/同步项目规则、推演代码影响链路及生成 Mermaid 图谱


## [0.8.0] — 2026-08-14

### 新功能

- **⚡️ OpenAPI / Swagger 专精加载器**：一键将 OpenAPI 3.0 / 3.1 与 Swagger 2.0 规范（JSON / YAML / URL）提炼为结构化 API 技能手册
  - 深度 `$ref` 解引用展开与循环引用防护，消除跨模型嵌套割裂
  - 接口结构化提炼：按 Tag 模块聚类，精确解析 Method、Path、OperationId、Query/Path/Header 参数、RequestBody Schema 及 2xx 响应字段
  - 极大降低 Token 消耗：自动剔除冗余模板与无用元数据，相比原始规范节省 80%~90% Token，消除 LLM 幻觉
  - 全链路自动分发：命令行传入 URL / 本地文件、Web UI 上传均自动检测并启用专精加载器
  - 新增编程式 API：`loadFromOpenApi` / `isOpenApiSpec` / `parseOpenApiSpec` / `renderOpenApiToMarkdown` / `extractOpenApiFromBuffer`

- **🔄 跨 Agent 规则互转与同步模式**（`--convert` / `--sync`）：在 Cursor、Codex、Claude 规则体系之间实现无损互转与项目全量同步
  - 自动识别三种 Agent 的规则规范（`.cursor/rules/*.mdc`、`.agents/skills/*/SKILL.md`、`CLAUDE.md` / `.claude/rules/*.md`）
  - 规则互转（`--convert <file> -t <type>`）：智能解析并规范化生成目标 Agent 专属目录与 Frontmatter
  - 项目一键全量同步（`--sync` / `--sync-from` / `--sync-to`）：自动探测当前项目所有规则，支持 `--dry-run` 预览
  - 超长规则渐进披露：转为 Codex 时超长内容自动拆分 `references/details.md`；转为 Claude 时超长规则拆入 `.claude/rules/`
  - 新增编程式 API：`convertRule` / `discoverProjectRules` / `syncProjectRules` / `parseRule` / `detectRuleFormat`

- **🔍 代码搜索模式**（`--scan-code` / `--search`）：扫描任意项目的代码文件，构建本地搜索索引，支持自然语言搜索代码。精准定位文件和行号，不用再打开 IDEA 手动搜索
  - 支持 25+ 种编程语言自动识别和符号提取（class / function / interface / enum 等）
  - 基于 TF-IDF + 多路召回（关键词 / 符号名 / 文件路径 / 全文模糊匹配）
  - 可选 LLM 智能解释搜索结果（中文说明 + 代码导航建议）
  - 交互式 REPL 模式（连续搜索，支持 `:plain` / `:stats` 等命令）
  - MCP Server 新增 `scan_code` 和 `search_code` 两个工具
 - 新增编程式 API：`initCodeIndex` / `searchProjectCode` / `CodeSearcher` / `buildIndex` / `searchCode` 等

- **📦 环境迁移模式**（`--env-export` / `--env-import`）：扫描当前电脑的开发环境，生成 JSON 快照和一键安装脚本，换新电脑时一键恢复全部配置
  - 扫描范围：Homebrew（formulae + casks）/ npm 全局包 / pip 包 / SDK 运行时 / VSCode 扩展 / macOS 应用 / Shell 配置 / Git 全局配置 / SSH 配置
  - 生成 `devtoolkit-env.json`（完整快照）和 `devtoolkit-env-setup.sh`（可执行安装脚本）
  - `--env-import` 支持 dry-run 预览和 `--execute` 实际执行两种模式
  - 安全设计：SSH 私钥不自动迁移，仅提示手动处理
  - 新增编程式 API：`exportEnv` / `importEnv` / `detectEnvironment` / `exportEnvironment` / `importEnvironment` 等

## [0.7.0] — 2026-08-13

### 新功能

- **MCP Server 模式**（`--mcp`）：通过 stdio JSON-RPC 2.0 协议让 AI Agent（Claude Desktop / Cursor 等）直接调用 devtoolkit。提供 `generate_skill` 和 `scan_directory` 两个工具
- **批量目录处理**：传入目录路径时自动递归扫描，每个文件生成独立技能包；`--merge` 合并为一个，`--dir-depth` 控制扫描深度
- 新增 `scanDirectory` / `expandSources` / `isDirectory` / `isSupportedFile` 编程式 API

### P1 — 长文档、原生格式、增量与质量闭环

- 长文档改为全量语义分块、并发抽取、分层归并与最终合成，移除 60,000 字符静默截断
- 默认输出当前推荐结构：Codex `.agents/skills/<name>/SKILL.md`、Cursor `.cursor/rules/<name>.mdc`、Claude 超长规则拆入 `.claude/rules/`
- Codex 超长技能自动拆分 `references/details.md`，实现渐进披露；`--legacy` 可保留旧版单文件
- 增量缓存纳入模型、温度、模板、名称、输出模式、Prompt 版本等完整指纹，并校验、复用磁盘真实产物
- 生成物和缓存改用临时文件 + rename 原子写入
- 新增格式、元数据、长度、重复度质量检查与评分，并返回分块和缓存统计
- Web UI 支持一键下载完整 ZIP，保留 Agent 原生目录；ZIP 使用短期、有界、不可猜测的本地下载票据

### 修复

- 修复 npm 根入口误指向 CLI，恢复 `import { devtoolkit } from 'ai-devtoolkit'`
- 恢复 `-w / --watch` 参数并增加端口、爬取参数和模板校验
- 统一 `--local-model`、`OLLAMA_MODEL`、`LMSTUDIO_MODEL` 与 `LOCAL_MODEL_NAME`
- Web UI 改为仅监听回环地址，禁止读取服务端本地路径
- 增加 Host / Origin / 会话令牌校验、请求体和并发限制
- 公网 URL 抓取增加 DNS、重定向、私网地址与响应大小校验
- Node.js 最低版本调整为 20.19，与运行时和开发依赖保持一致
- CI 增加 Lint、格式和 npm 发布包 smoke test

## [0.6.2] — 2026-07-31

### 新功能

- Web UI 支持 PDF / DOCX 文件上传和本地模型自动探测
- 修复假 PDF 的 HTML 降级提取、技能名扩展名清理及上传状态问题

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
- `.devtoolkit-cache.json` 缓存增量更新状态

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

- **编程式 API**：可作为 Node.js 库使用（`import { devtoolkit } from 'ai-devtoolkit'`），双入口构建（CLI + lib）
- **dry-run 预览模式**：`--dry-run` 只查看生成结果不写文件
- **覆盖保护**：文件已存在时拒绝覆盖，`--force` 强制覆盖
- **配置文件支持**：`.devtoolkit.json` 项目级默认值，CLI 参数优先覆盖
- **本地 HTML 文件**：`.html` / `.htm` 文件走 cheerio + turndown 正文提取管线
- **examples 目录**：编程式 API 示例 + CLI 快速参考 + 样例文档

### 改进

- tsup 双入口构建（index CLI + lib 编程式 API）
- package.json exports 字段支持子路径导入
- 测试增强至 60 个用例（新增 config / dry-run / 覆盖保护 / HTML loader 测试）

## [0.2.0] — 2026-07-31

### 新功能

- **交互式向导**：无参数运行 `npx ai-devtoolkit` 进入引导问答，逐步选择来源/类型/模型
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
