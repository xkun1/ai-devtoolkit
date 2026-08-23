import type { AgentType, SourceType } from '../types/index.js';

/** 统一 Skill 中间表示版本。 */
export const SKILL_IR_VERSION = '1.0.0' as const;

/** Agent Skills 标准元数据。 */
export interface SkillMetadata {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Agent Skills 的 experimental `allowed-tools` 字段。 */
  allowedTools?: string;
}

export interface SkillSource {
  source: string;
  type?: SourceType;
  title?: string;
  url?: string;
}

export interface SkillApplicability {
  globs?: string[];
  alwaysApply?: boolean;
}

export type SkillResourceKind = 'reference' | 'script' | 'asset';

/** Skill 根目录下的附属资源，path 必须是安全的相对路径。 */
export interface SkillResource {
  path: string;
  content: string;
  kind: SkillResourceKind;
}

/**
 * 与具体 Agent 无关的统一 Skill 中间表示。
 *
 * 所有生成与规则互转先进入该结构，再由平台适配器编译为最终文件。
 */
export interface SkillIR {
  schemaVersion: typeof SKILL_IR_VERSION;
  metadata: SkillMetadata;
  title?: string;
  instructions: string;
  applicability?: SkillApplicability;
  resources: SkillResource[];
  source?: SkillSource;
}

export interface CreateSkillIRInput {
  content: string;
  name?: string;
  title?: string;
  description?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
  applicability?: SkillApplicability;
  resources?: SkillResource[];
  source?: SkillSource;
}

export interface CompileSkillOptions {
  agentType: AgentType;
  outputPath?: string;
  outputRoot?: string;
  outputMode?: 'modern' | 'legacy';
}

export interface SkillValidationIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;
}

export interface SkillValidationReport {
  skillDirectory: string;
  skillFile: string;
  name?: string;
  description?: string;
  passed: boolean;
  issues: SkillValidationIssue[];
  metrics: {
    lines: number;
    bytes: number;
    references: number;
  };
}

export interface SkillValidationOptions {
  /** 开启后，warning 也会令汇总结果失败。 */
  strict?: boolean;
  /** 是否检查 SKILL.md 中的本地 Markdown 链接，默认 true。 */
  checkLinks?: boolean;
}

export interface SkillValidationSummary {
  target: string;
  strict: boolean;
  passed: boolean;
  reports: SkillValidationReport[];
  issues: SkillValidationIssue[];
  totals: {
    skills: number;
    errors: number;
    warnings: number;
  };
}
