/**
 * 编程式 API 统一导出入口
 *
 * 用法：
 * ```ts
 * import { doc2skill } from 'doc2skill';
 *
 * const result = await doc2skill('https://docs.example.com/api', {
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

export {
  transformToSkill,
  transformDocumentToSkill,
  buildPrompt,
  callLLM,
  splitDocument,
  DEFAULT_CHUNK_CHARS,
} from './transform/index.js';
export type { TransformOptions, TransformResult } from './transform/index.js';

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
 * const result = await doc2skill(url, options);
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

export { runPipeline as doc2skill } from './pipeline.js';

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
