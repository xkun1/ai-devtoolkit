/**
 * 编程式 API 统一导出入口
 *
 * 用法：
 * ```ts
 * import { devtoolkit } from 'ai-devtoolkit';
 *
 * const result = await devtoolkit('https://docs.example.com/api', {
 *   agentType: 'codex',
 *   llm: { apiKey: 'sk-xxx', model: 'deepseek-chat' },
 * });
 * console.log(result.content);
 * ```
 */
export type {
  AgentType,
  OutputMode,
  SourceType,
  LoadedDocument,
  LLMConfig,
  SkillResult,
  GeneratedArtifact,
  GenerationStats,
  QualityIssue,
  QualityReport,
  PipelineOptions,
} from './types/index.js';

export {
  crawlSite,
  detectSourceType,
  loadDocument,
  loadDocuments,
  mergeDocuments,
  loadFromUrl,
  loadFromPdf,
  loadFromFile,
  loadFromHtml,
} from './loader/index.js';
export type { LoadOptions } from './loader/index.js';

export {
  transformToSkill,
  transformDocumentToSkill,
  buildPrompt,
  callLLM,
  splitDocument,
  DEFAULT_CHUNK_CHARS,
} from './transform/index.js';
export type { TransformOptions, TransformResult } from './transform/index.js';
export type { CallLLMOptions } from './transform/llm.js';

export {
  OperationAbortedError,
  OperationTimeoutError,
  ResourceLimitError,
  isAbortError,
} from './utils/abort.js';

export {
  formatResult,
  isValidAgentType,
  DEFAULT_OUTPUT_PATHS,
  buildArtifacts,
  resolvePrimaryPath,
} from './format/index.js';

export {
  slugify,
  normalizeSkillName,
  extractDescription,
  hasFrontmatter,
  injectSkillFrontmatter,
} from './format/frontmatter.js';

export { runPipeline } from './pipeline.js';

/**
 * 一行调用快捷方法 — 等价于 runPipeline，语义更友好
 * ```ts
 * const result = await devtoolkit(url, options);
 * ```
 */
export {
  MODEL_PRESETS,
  MODEL_DISPLAY,
  isLocalModel,
  resolveModel,
  detectLocalModels,
} from './models.js';
export type { ModelDisplayItem, LocalModelInfo } from './models.js';
export type { ModelPreset } from './types/index.js';

export { runPipeline as devtoolkit } from './pipeline.js';

export { startServer, WEB_UI_HTML } from './server.js';
export type { ServerOptions } from './server.js';

export { startMcpServer } from './mcp-server.js';
export type { McpServerOptions } from './mcp-server.js';

export {
  scanDirectory,
  isDirectory,
  isSupportedFile,
  expandSources,
} from './loader/directory.js';
export type { ScanOptions } from './loader/directory.js';

export {
  TEMPLATES,
  getTemplate,
  listTemplates,
  isValidTemplate,
  listTemplatesByCategory,
} from './templates/index.js';
export type { SkillTemplate } from './templates/index.js';

// ── 代码搜索 API ──
export {
  initCodeIndex,
  searchProjectCode,
  searchAndPrint,
  startSearchSession,
  buildIndex,
  saveIndex,
  loadIndex,
  hasIndex,
  INDEX_FILENAME,
  searchCode,
  CodeSearcher,
  explainResults,
  formatResultsPlain,
  startInteractiveSearch,
  scanCodeFiles,
  detectLanguage,
  isCodeFile,
  extractSymbols,
  readCodeFile,
} from './search/index.js';
export type {
  CodeFile,
  CodeChunk,
  CodeSymbol,
  SearchResult as CodeSearchResult,
  SearchIndex as CodeSearchIndex,
  SearchOptions as CodeSearchOptions,
  ScanCodeOptions,
  LanguageId,
  ExplainOptions,
  IndexMeta,
} from './search/index.js';

export {
  contentHash,
  getCachePath,
  needsUpdate,
  markGenerated,
  buildGenerationFingerprint,
  createCacheKey,
  loadCachedResult,
  saveGeneratedResult,
} from './utils/hash.js';

export {
  validateSkillResult,
  assertValidSkillResult,
  QUALITY_BASELINE_VERSION,
} from './quality/validate.js';

export { estimateTokens, estimateCost, formatCost } from './utils/token.js';
export { writeFileAtomic } from './utils/atomic-write.js';
export { createArtifactZip } from './utils/zip.js';
export type { ZipPackage } from './utils/zip.js';
export { DownloadStore } from './utils/download-store.js';
export type {
  DownloadStoreOptions,
  DownloadTicket,
} from './utils/download-store.js';

// ── 环境迁移 API ──
export { exportEnv, importEnv, diffEnv } from './env/index.js';
export {
  exportEnvironment,
  generateSetupScript,
  SNAPSHOT_VERSION,
} from './env/index.js';
export {
  importEnvironment,
  loadSnapshot,
  formatImportPreview,
  diffEnvironment,
  formatDiffPreview,
  validateEnvSnapshot,
} from './env/index.js';
export {
  detectEnvironment,
  detectBrew,
  detectNpmGlobal,
  detectPip,
  detectSdks,
  detectVscodeExtensions,
  detectMacApps,
  detectShell,
  detectGit,
  detectSsh,
} from './env/index.js';
export type {
  EnvSnapshot,
  BrewPackages,
  NpmGlobalPackage,
  PipPackage,
  SdkInfo,
  VscodeExtension,
  MacApp,
  ShellConfig,
  GitConfig,
  SshConfig,
  DetectOptions,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
  EnvDiffResult,
  DiffItem,
  EnvModule,
} from './env/index.js';

// ── 跨 Agent 规则互转与同步 API ──
export {
  convertFile,
  syncRules,
  convertRule,
  parseRule,
  detectRuleFormat,
  discoverProjectRules,
  syncProjectRules,
} from './convert/index.js';
export type {
  ConvertOptions,
  ConvertResult,
  ParsedRule,
  RuleFormat,
  RuleMetadata,
  SyncOptions,
  SyncResult,
  SyncOperation,
  DiscoveredRules,
} from './convert/index.js';

// ── OpenAPI / Swagger 专精加载器 API ──
export {
  loadFromPostman,
  isPostmanCollection,
  parsePostmanCollection,
  renderPostmanToMarkdown,
  extractPostmanFromBuffer,
  loadFromOpenApi,
  isOpenApiSpec,
  parseOpenApiSpec,
  renderOpenApiToMarkdown,
  extractOpenApiFromBuffer,
} from './loader/index.js';
export type {
  OpenApiParameter,
  OpenApiField,
  OpenApiEndpoint,
  ParsedOpenApi,
} from './loader/index.js';

// ── 技能效果评测 (Skill Eval) API ──
export {
  generateEvalSuite,
  generateFallbackCases,
  runSkillEval,
  formatEvalReportMarkdown,
  evalSkillFile,
} from './eval/index.js';
export type {
  EvalCase,
  EvalSuite,
  CaseEvalResult,
  EvalReport,
  GenerateEvalOptions,
  RunEvalOptions,
} from './eval/index.js';

// ── 代码依赖图谱与影响面分析 API ──
export {
  buildDependencyGraph,
  analyzeImpact,
  formatImpactReport,
  generateMermaidGraph,
  printProjectGraph,
  printImpactAnalysis,
} from './graph/index.js';
export type {
  DependencyGraph,
  GraphNode,
  GraphEdge,
  ImpactAnalysisResult,
} from './graph/index.js';
