export type AgentType = 'codex' | 'cursor' | 'claude';

/** 输出格式：modern 使用各 Agent 当前推荐目录结构，legacy 保留旧版单文件。 */
export type OutputMode = 'modern' | 'legacy';

export type SourceType =
  'url' | 'pdf' | 'html' | 'markdown' | 'text' | 'openapi' | 'postman';

/** 加载后的统一文档结构 */
export interface LoadedDocument {
  source: string;
  type: SourceType;
  content: string;
  title?: string;
  url?: string;
  meta?: Record<string, string>;
}

/** LLM 调用配置 */
export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  /** 单次模型响应的最大 token 数；默认 8192。 */
  maxOutputTokens?: number;
}

/** 模型预设扩展：本地模型标记 */
export interface ModelPreset {
  baseURL?: string;
  envVar: string;
  description: string;
  /** 本地模型标记：跳过 API Key 检查 */
  local?: boolean;
}

/** 一次生成产生的文件。primary 是兼容旧 API 的主文件。 */
export interface GeneratedArtifact {
  path: string;
  content: string;
  kind: 'primary' | 'reference' | 'rule';
}

/** 长文档提炼与缓存统计。 */
export interface GenerationStats {
  sourceChars: number;
  processedChars: number;
  sourceChunks: number;
  llmCalls: number;
  reductionPasses: number;
  cacheHit: boolean;
}

export interface QualityIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

/** 生成物的静态质量检查结果。 */
export interface QualityReport {
  score: number;
  passed: boolean;
  issues: QualityIssue[];
  metrics: {
    artifactCount: number;
    totalChars: number;
    primaryLines: number;
    duplicateLineRatio: number;
  };
}

/** 生成结果 */
export interface SkillResult {
  agentType: AgentType;
  content: string;
  suggestedPath: string;
  /** 完整生成物；content/suggestedPath 始终对应 primary。 */
  artifacts?: GeneratedArtifact[];
  stats?: GenerationStats;
  quality?: QualityReport;
}

/** 全流程选项 */
export interface PipelineOptions {
  agentType: AgentType;
  outputPath?: string;
  llm: LLMConfig;
  verbose?: boolean;
  /** 自定义技能名（用于 Codex SKILL.md frontmatter），默认从文档标题生成 */
  name?: string;
  /** 输出到 stdout 而不写文件 */
  stdout?: boolean;
  /** 预览模式：只输出结果到终端，不写文件 */
  dryRun?: boolean;
  /** 强制覆盖（已存在文件时不报错） */
  force?: boolean;
  /** 爬取模式：自动发现并抓取子页面 */
  crawl?: boolean;
  /** 爬取最大深度 */
  crawlDepth?: number;
  /** 爬取最大页面数 */
  crawlPages?: number;
  /** watch 模式（文档变更后自动重新生成） */
  watch?: boolean;
  /** 技能包模板 ID（如 api-doc / coding-guide / cheatsheet） */
  template?: string;
  /** 增量更新：跳过未变更的文档 */
  incremental?: boolean;
  /** 默认 modern；legacy 保留 SKILL.md/.cursorrules/CLAUDE.md 单文件输出。 */
  outputMode?: OutputMode;
  /** 预加载内容（Web UI 文件上传用，跳过 loader 直接传入原始文本） */
  preloaded?: PreloadedContent;
  /** 目录模式下合并所有文件为一个技能包（默认逐文件生成独立技能包） */
  mergeDir?: boolean;
  /** 目录扫描最大递归深度（默认 5） */
  dirMaxDepth?: number;
  /** 上游取消信号。 */
  signal?: AbortSignal;
  /** 单次 LLM 调用超时，默认 120 秒。 */
  llmTimeoutMs?: number;
  /** 单次 LLM 响应字符上限，默认 1 MiB。 */
  maxOutputChars?: number;
  /** 单次技能生成允许的最大 LLM 调用数，默认 100。 */
  maxLLMCalls?: number;
  /** 目录批处理并发数，默认 2，最大 8。 */
  batchConcurrency?: number;
  /** 目录批处理文件数上限，默认 100。 */
  maxBatchFiles?: number;
}

/** 预加载的文档内容（Web UI 文件上传用，跳过 loader 直接传入内容） */
export interface PreloadedContent {
  /** 原始内容文本 */
  content: string;
  /** 文件名（用于生成标题） */
  fileName?: string;
  /** 来源标记 */
  source?: string;
  /** 二进制内容（Base64 编码），用于 PDF/DOCX 上传 */
  binaryContent?: string;
  /** 文件 MIME 类型（如 application/pdf） */
  mimeType?: string;
}
