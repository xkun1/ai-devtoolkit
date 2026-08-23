# 编程式 API Reference

包根入口 `ai-devtoolkit` 与兼容入口 `ai-devtoolkit/lib` 导出相同 API；轻量场景可使用 `ai-devtoolkit/search` 或 `ai-devtoolkit/security` 子入口。以下函数均为 ESM/CJS 可调用的公共接口；类型只在 TypeScript 编译期存在。

## 1. 生成管线

| API | 参数与返回值 |
| --- | --- |
| `runPipeline` / `devtoolkit` | `(sources: string \| string[], options: PipelineOptions): Promise<SkillResult>`。`sources` 为 URL、文件或目录；`options.agentType`、`options.llm` 必填，其余控制输出路径、模板、爬取、缓存、并发、`stdout`/`dryRun` 等。 |
| `transformToSkill` | `(doc, config, agentType, name?, template?): Promise<string>`。将已加载文档交给 LLM，返回技能 Markdown。 |
| `transformDocumentToSkill` | 同上，返回 `TransformResult`（正文和分块/调用统计）；可传 `TransformOptions` 控制分块并发、超时、响应字符和最大调用次数。 |
| `buildPrompt` | `(doc, agentType, name?, template?, lang?): string`，构造默认技能提炼提示词。 |
| `callLLM` | `(prompt, config, options?): Promise<string>`。调用 OpenAI 兼容 Chat Completions；`options` 可指定 system prompt、temperature、AbortSignal、timeout 和最大输出字符。 |
| `splitDocument` | `(content, maxChars = DEFAULT_CHUNK_CHARS): DocumentChunk[]`。按标题、段落和代码块安全边界分块，`maxChars` 不得小于 1000。 |
| `buildArtifacts` | `(options: ArtifactOptions): SkillResult`。按 Agent 目标生成主文件、引用文件或规则文件。 |
| `formatResult` | `(content: string, agentType: AgentType, outputPath?): SkillResult`，生成兼容旧调用方的单文件结果。 |
| `resolvePrimaryPath` | `(agentType, doc, name?, outputPath?, outputMode?): string`，计算主产物路径。 |
| `isValidAgentType` | `(value: string): value is AgentType`。校验 Agent 类型。 |
| `validateSkillResult` | `(result: SkillResult): QualityReport`，返回质量评分、问题和指标。 |
| `assertValidSkillResult` | `(result: SkillResult): QualityReport`，质量不满足基线时抛错，否则返回报告。 |

### 生成相关类型

- `PipelineOptions`：`agentType`、`llm` 必填；常用可选项为 `outputPath`、`name`、`stdout`、`dryRun`、`force`、`crawl`、`crawlDepth`、`crawlPages`、`template`、`incremental`、`outputMode`、`preloaded`、`mergeDir`、`dirMaxDepth`、`llmTimeoutMs`、`maxOutputChars`、`maxLLMCalls`、`batchConcurrency`、`maxBatchFiles`、`lang`、`sensitivePolicy`。
- `LLMConfig`：`apiKey`、`model` 必填；`baseURL`、`temperature`、`maxOutputTokens` 可选。
- `SkillResult`：`agentType`、`content`、`suggestedPath`，以及可选 `artifacts`、`stats`、`quality`。
- `GeneratedArtifact`：`path`、`content`、`kind: 'primary' | 'reference' | 'rule'`。
- `LoadedDocument`：`source`、`type`、`content`，以及可选 `title`、`url`、`meta`。
- `TransformOptions`：`chunkChars`、`concurrency`、`signal`、`llmTimeoutMs`、`maxOutputChars`、`maxLLMCalls`、`lang`。
- `TransformResult`：`content` 与 `stats`（源字符、处理字符、分块数、LLM 调用数、归并轮数）。
- `AgentType`：`codex | cursor | claude | windsurf | copilot | gemini | aider`。
- `SensitivePolicy`：`redact | error | off`；默认在发送给 LLM 前和产物写入前脱敏。
- `OutputMode`：`modern | legacy`；`SourceType`：`url | pdf | html | markdown | text | openapi | postman`。

## 2. 文档加载与解析

| API | 参数与返回值 |
| --- | --- |
| `detectSourceType` | `(source: string): SourceType`，按扩展名、URL 和内容特征识别来源类型。 |
| `loadDocument` | `(source: string, options?: LoadOptions): Promise<LoadedDocument>`，统一加载入口。 |
| `loadDocuments` | `(sources: string[], options?: LoadOptions): Promise<LoadedDocument[]>`，并发加载多来源。 |
| `mergeDocuments` | `(documents: LoadedDocument[]): LoadedDocument`，将多个文档合并为一个文档。 |
| `loadFromUrl` | `(url: string, options?: SafeFetchOptions): Promise<LoadedDocument>`，安全抓取 URL。 |
| `loadFromFile` | `(path: string, type?: SourceType): Promise<LoadedDocument>`，读取本地文本文件。 |
| `loadFromPdf` | `(path: string): Promise<LoadedDocument>`，提取 PDF 正文。 |
| `loadFromHtml` | `(path: string): Promise<LoadedDocument>`，读取并提取 HTML 正文。 |
| `crawlSite` | `(url: string, options?): Promise<LoadedDocument>`，按深度/页面数限制爬取站点。 |
| `scanDirectory` | `(root: string, options?: ScanOptions): Promise<string[]>`，扫描受支持的文档。 |
| `expandSources` | `(sources, options?): Promise<{ files: string[] }>`，将文件和目录展开为文件列表。 |
| `isDirectory` | `(path: string): Promise<boolean>`，判断路径是否为目录。 |
| `isSupportedFile` | `(path: string): boolean`，判断扩展名是否受支持。 |

### OpenAPI / Swagger

| API | 参数与返回值 |
| --- | --- |
| `isOpenApiSpec` | `(content: string \| unknown, filename?): boolean`，识别 OpenAPI/Swagger。 |
| `parseOpenApiSpec` | `(raw: string \| unknown): ParsedOpenApi`，解析规范、端点、参数和响应。 |
| `renderOpenApiToMarkdown` | `(parsed: ParsedOpenApi): string`，渲染为 Markdown API 手册。 |
| `loadFromOpenApi` | `(source: string, content?, fetchOptions?): Promise<LoadedDocument>`，从路径、URL 或已提供内容加载。 |
| `extractOpenApiFromBuffer` | `(buffer: Buffer, fileName?): Promise<{ content; title; meta }>`，处理上传的规范文件。 |

### Postman Collection

| API | 参数与返回值 |
| --- | --- |
| `isPostmanCollection` | `(content: string \| unknown, filename?): boolean`，识别 Postman Collection。 |
| `parsePostmanCollection` | `(raw: string \| unknown): ParsedPostman`，解析集合。 |
| `renderPostmanToMarkdown` | `(parsed: ParsedPostman): string`，渲染请求、参数和示例。 |
| `loadFromPostman` | `(source: string, content?, fetchOptions?): Promise<LoadedDocument>`，统一加载入口。 |
| `extractPostmanFromBuffer` | `(buffer: Buffer, fileName?): Promise<{ content; title; meta }>`，处理上传集合。 |

`LoadOptions`/`SafeFetchOptions` 可控制 `maxBytes`、`timeoutMs`、`maxRedirects`、`signal`；目录 `ScanOptions` 还支持 `maxDepth`、`maxFiles`、扩展名过滤。

## 3. Frontmatter、模板与文件工具

| API | 参数与返回值 |
| --- | --- |
| `slugify` | `(text: string): string`，将标题转为最多 64 字符的 ASCII slug。 |
| `normalizeSkillName` | `(text: string): string`，规范化显式技能名。 |
| `extractDescription` | `(content: string, fallback: string): string`，从 H1/首行提取描述。 |
| `hasFrontmatter` | `(content: string): boolean`，判断开头是否已有 YAML frontmatter。 |
| `injectSkillFrontmatter` | `(content: string, input: { name?; title?; description? }): string`，为 Codex 技能注入 `name`/`description`；已有 frontmatter 时保持不变。 |
| `TEMPLATES` | 内置 `SkillTemplate[]` 注册表。 |
| `getTemplate` | `(id: string): SkillTemplate \| undefined`。 |
| `listTemplates` | `(): SkillTemplate[]`。 |
| `listTemplatesByCategory` | `(category: string): SkillTemplate[]`。 |
| `isValidTemplate` | `(id: string): boolean`。 |
| `writeFileAtomic` | `(path: string, content: string | Uint8Array): Promise<void>`，原子写入文件。 |
| `writeFilesAtomic` | `(files: AtomicFileWrite[]): Promise<void>`，预检并批量写入；任一步失败时恢复已改动文件。 |
| `createArtifactZip` | `(packages: ZipPackage[]): Promise<Buffer>`，把多个产物打包为 ZIP。 |
| `DownloadStore` | 下载临时存储类；构造参数 `DownloadStoreOptions`，使用 `create/read/consume/delete` 管理 `DownloadTicket`。 |

## 4. 模型、缓存与成本

| API | 参数与返回值 |
| --- | --- |
| `MODEL_PRESETS` / `MODEL_DISPLAY` | 云端和本地模型的预设及 UI 展示元数据。 |
| `isLocalModel` | `(modelId: string): boolean`。 |
| `resolveModel` | `(modelId, options?: { apiKey?; baseUrl?; localModelName? }): LLMConfig`，解析环境变量、Base URL 和本地模型名。 |
| `detectLocalModels` | `(baseURL: string, timeoutMs?: number, signal?): Promise<LocalModelInfo[]>`，探测 OpenAI 兼容或 Ollama 模型列表。 |
| `contentHash` | `(content: string): string`，计算内容哈希。 |
| `getCachePath` | `(primaryPath: string): string`，取得生成缓存位置。 |
| `needsUpdate` | `(path: string, fingerprint: string): boolean`，判断缓存是否需要刷新。 |
| `markGenerated` | `(path: string, fingerprint: string): void`，记录生成指纹。 |
| `buildGenerationFingerprint` | `(input): string`，基于源文档、Agent、模型、模板和提示词版本生成指纹。 |
| `createCacheKey` | `(source: string, outputPath: string): string`。 |
| `loadCachedResult` | `(cachePath, cacheKey, fingerprint, agentType): SkillResult \| null`。 |
| `saveGeneratedResult` | `(cachePath, cacheKey, fingerprint, result): void`。 |
| `estimateTokens` | `(text: string): number`。 |
| `estimateCost` | `(inputTokens, outputTokens, model): { input; output; total } \| null`。 |
| `formatCost` | `(cost: number): string`。 |

## 5. 代码搜索与依赖图

### 搜索

| API | 参数与返回值 |
| --- | --- |
| `scanCodeFiles` | `(root: string, options?: ScanCodeOptions): Promise<CodeFile[]>`，扫描代码文件。 |
| `detectLanguage` | `(path: string): LanguageId`。 |
| `isCodeFile` | `(path: string): boolean`。 |
| `extractSymbols` | `(content: string, language: LanguageId): CodeSymbol[]`。 |
| `readCodeFile` | `(path: string): Promise<CodeFile>`。 |
| `buildIndex` | `(options?: ScanCodeOptions): Promise<SearchIndex>`。 |
| `saveIndex` / `loadIndex` | `(root: string, index?): Promise<string \| SearchIndex>`，保存或读取索引。 |
| `hasIndex` | `(root: string): Promise<boolean>`。 |
| `initCodeIndex` | `(options?: CodeSearchOptions): Promise<SearchIndex>`。 |
| `searchCode` | `(index: SearchIndex, query: string, options?): CodeSearchResult[]`。 |
| `searchProjectCode` | `(query: string, options?, root?): Promise<{ results; index }>`。 |
| `explainResults` | `(query: string, results, llm, options?): Promise<string>`。 |
| `formatResultsPlain` | `(results: CodeSearchResult[]): string`。 |
| `searchAndPrint` | `(query, llm?, explain?, root?, options?): Promise<void>`。 |
| `startSearchSession` / `startInteractiveSearch` | 启动交互式搜索会话；参数为可选 LLM 配置、解释开关、项目根目录和取消/超时选项。 |
| `CodeSearcher` | 搜索器类；构造 `SearchIndex`，实例方法执行查询和结果解释。 |

### 依赖图

| API | 参数与返回值 |
| --- | --- |
| `buildDependencyGraph` | `(options?: GraphOptions): Promise<DependencyGraph>`，扫描 import/export 构建图。 |
| `analyzeImpact` | `(graph, targetFile: string, symbol?): ImpactAnalysisResult`。 |
| `formatImpactReport` | `(result: ImpactAnalysisResult): string`。 |
| `generateMermaidGraph` | `(graph, options?: { maxNodes?; direction?: 'TD' \| 'LR' }): string`。 |
| `printProjectGraph` | `(options?: GraphOptions & { direction? }): Promise<string>`。 |
| `printImpactAnalysis` | `(targetFile: string, options?: GraphOptions): Promise<ImpactAnalysisResult>`。 |
| `loadGraphCache` / `saveGraphCache` / `clearGraphCache` | 以项目根目录为参数读、写、清除 `.devtoolkit-graph.json`。 |

## 6. 环境迁移与规则互转

| API | 参数与返回值 |
| --- | --- |
| `detectEnvironment` | `(options?: DetectOptions): Promise<EnvSnapshot>`，探测当前系统开发资产。 |
| `detectBrew` / `detectNpmGlobal` / `detectPip` / `detectSdks` | `(): Promise<...>`，分别探测 Homebrew、npm、pip 和 SDK。 |
| `detectVscodeExtensions` / `detectMacApps` / `detectShell` / `detectGit` / `detectSsh` | `(): Promise<...>`，分别探测 VS Code 扩展、macOS App、Shell、Git、SSH。 |
| `exportEnvironment` / `exportEnv` | `(options?: ExportOptions): Promise<ExportResult>`，导出快照和安装脚本。 |
| `generateSetupScript` | `(snapshot: EnvSnapshot): string`。 |
| `importEnvironment` / `importEnv` | `(snapshotOrPath, options?: ImportOptions): Promise<ImportResult>`；默认预览，`execute: true` 才执行安装。 |
| `loadSnapshot` | `(path: string): Promise<EnvSnapshot>`。 |
| `formatImportPreview` | `(result: ImportResult): string`。 |
| `diffEnvironment` / `diffEnv` | `(snapshotOrPath, options?): Promise<EnvDiffResult>`。 |
| `formatDiffPreview` | `(result: EnvDiffResult): string`。 |
| `validateEnvSnapshot` | `(value: unknown): value is EnvSnapshot`。 |
| `convertFile` | `(file: string, targetAgent: AgentType, options?: ConvertOptions): Promise<ConvertResult>`。 |
| `convertRule` | `(rule: ParsedRule, target: RuleFormat, options?): ParsedRule`。 |
| `parseRule` | `(content: string, sourceFormat?: RuleFormat): ParsedRule`。 |
| `detectRuleFormat` | `(fileOrContent: string): RuleFormat`。 |
| `discoverProjectRules` | `(projectRoot?: string): DiscoveredRules`。 |
| `syncRules` / `syncProjectRules` | `(options: SyncOptions): Promise<SyncResult>`，在项目内发现并同步多个 Agent 规则，可 `dryRun`。 |

## 7. 评测、生命周期、安全与辅助服务

| API | 参数与返回值 |
| --- | --- |
| `generateEvalSuite` | `(skillFile: string, options?: GenerateEvalOptions): Promise<EvalSuite>`。 |
| `generateFallbackCases` | `(skillContent: string, maxCases?: number): EvalCase[]`。 |
| `runSkillEval` / `evalSkillFile` | `(skillOrFile, options?: RunEvalOptions): Promise<EvalReport>`。 |
| `formatEvalReportMarkdown` | `(report: EvalReport): string`。 |
| `runMultiModelEval` | `(skillFile, models, options?): Promise<...>`。 |
| `formatMultiModelReport` | `(report): string`。 |
| `loadRegistry` / `saveRegistry` | 以 `projectRoot` 或 `SkillRegistry` 为参数读写技能注册表。 |
| `registerSkill` | `(registry, skill: Omit<InstalledSkill, 'version'>): void`。 |
| `listSkills` | `(projectRoot?): Promise<SkillStatus[]>`。 |
| `removeSkill` | `(name: string, projectRoot?): Promise<boolean>`。 |
| `RegistryValidationError` | 注册表损坏、路径越界或条目结构不合法时抛出的显式错误。 |
| `redactContent` | `(content: string): RedactResult`，脱敏并返回匹配规则/数量。 |
| `detectSensitiveInfo` | `(content: string): { found; rules; count }`，只检测不修改。 |
| `runDoctor` | `(projectRoot?): Promise<DoctorReport>`。 |
| `printDoctorReport` | `(report: DoctorReport): void`。 |
| `generateRepoMap` | `(options?: RepoMapOptions): Promise<string>`。 |
| `generateRefreshWorkflow` | `(options: RefreshWorkflowOptions): string`，生成 GitHub Actions 定时刷新 YAML。 |
| `startServer` | `(options?: ServerOptions): Server`，启动本地 Web UI HTTP Server。 |
| `WEB_UI_HTML` | 内嵌 Web UI HTML 字符串。 |
| `startMcpServer` | `(options?: McpServerOptions): void`，启动 MCP stdio 服务。 |

### 错误类型与常量

- `OperationAbortedError`、`OperationTimeoutError`、`ResourceLimitError`：分别表示用户取消、超时和资源上限；`isAbortError(error)` 可判断取消类错误。
- `DEFAULT_CHUNK_CHARS`、`DEFAULT_OUTPUT_PATHS`、`QUALITY_BASELINE_VERSION`、`INDEX_FILENAME`、`SNAPSHOT_VERSION`、`GRAPH_CACHE_VERSION`、`GRAPH_CACHE_FILENAME`、`REGISTRY_VERSION`、`REGISTRY_FILENAME`：公开默认值/文件名常量。

### 公共领域类型索引

环境：`EnvSnapshot`、`BrewPackages`、`NpmGlobalPackage`、`PipPackage`、`SdkInfo`、`VscodeExtension`、`MacApp`、`ShellConfig`、`GitConfig`、`SshConfig`、`DetectOptions`、`ExportOptions`、`ExportResult`、`ImportOptions`、`ImportResult`、`EnvDiffResult`、`DiffItem`、`EnvModule`。

搜索/图谱：`CodeFile`、`CodeChunk`、`CodeSymbol`、`CodeSearchResult`、`CodeSearchIndex`、`CodeSearchOptions`、`ScanCodeOptions`、`LanguageId`、`ExplainOptions`、`IndexMeta`、`DependencyGraph`、`GraphNode`、`GraphEdge`、`DependencyGraphStats`、`GraphOptions`、`ImpactAnalysisResult`、`DependencyGraphCache`、`FileNodeCache`。

规则/评测：`ConvertOptions`、`ConvertResult`、`ParsedRule`、`RuleFormat`、`RuleMetadata`、`SyncOptions`、`SyncResult`、`SyncOperation`、`DiscoveredRules`、`EvalCase`、`EvalSuite`、`CaseEvalResult`、`EvalReport`、`GenerateEvalOptions`、`RunEvalOptions`。

服务/生命周期：`ServerOptions`、`McpServerOptions`、`InstalledSkill`、`SkillRegistry`、`SkillStatus`、`RedactResult`、`DoctorCheck`、`DoctorReport`、`RepoMapOptions`、`RepoMapEntry`、`RefreshWorkflowOptions`、`ZipPackage`、`DownloadStoreOptions`、`DownloadTicket`、`SkillTemplate`。
