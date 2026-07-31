export type AgentType = 'codex' | 'cursor' | 'claude';

export type SourceType = 'url' | 'pdf' | 'html' | 'markdown' | 'text';

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
}

/** 模型预设扩展：本地模型标记 */
export interface ModelPreset {
  baseURL?: string;
  envVar: string;
  description: string;
  /** 本地模型标记：跳过 API Key 检查 */
  local?: boolean;
  /** 本地模型实际名环境变量（如 OLLAMA_MODEL） */
  localModelEnv?: string;
}

/** 生成结果 */
export interface SkillResult {
  agentType: AgentType;
  content: string;
  suggestedPath: string;
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
  /** 预加载内容（Web UI 文件上传用，跳过 loader 直接传入原始文本） */
  preloaded?: PreloadedContent;
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
