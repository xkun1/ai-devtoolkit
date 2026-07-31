export type AgentType = 'codex' | 'cursor' | 'claude';

export type SourceType = 'url' | 'pdf' | 'markdown' | 'text';

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
}
