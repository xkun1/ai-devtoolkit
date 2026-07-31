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
  SourceType,
  LoadedDocument,
  LLMConfig,
  SkillResult,
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

export { transformToSkill, buildPrompt, callLLM } from './transform/index.js';

export {
  formatResult,
  isValidAgentType,
  DEFAULT_OUTPUT_PATHS,
} from './format/index.js';

export {
  slugify,
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
export { runPipeline as doc2skill } from './pipeline.js';

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
} from './utils/hash.js';

export { estimateTokens, estimateCost, formatCost } from './utils/token.js';
