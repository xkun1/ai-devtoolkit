/**
 * 跨 Agent 规则转换与同步类型定义
 */
import type { AgentType, GeneratedArtifact } from '../types/index.js';

export type RuleFormat = 'cursor' | 'codex' | 'claude' | 'generic';

export interface RuleMetadata {
  name?: string;
  description?: string;
  globs?: string[];
  alwaysApply?: boolean;
}

export interface ParsedRule {
  format: RuleFormat;
  meta: RuleMetadata;
  title?: string;
  body: string;
  rawContent: string;
  sourcePath?: string;
  references?: { path: string; content: string }[];
}

export interface ConvertOptions {
  from?: RuleFormat;
  to: AgentType;
  name?: string;
  outputDir?: string;
}

export interface ConvertResult {
  from: RuleFormat;
  to: AgentType;
  parsed: ParsedRule;
  artifacts: GeneratedArtifact[];
}

export interface DiscoveredRules {
  agentType: AgentType;
  format: RuleFormat;
  baseDir: string;
  files: { path: string; name: string }[];
}

export interface SyncOptions {
  projectRoot?: string;
  from?: AgentType | 'auto';
  to?: AgentType[];
  dryRun?: boolean;
}

export interface SyncOperation {
  targetAgent: AgentType;
  sourceFile: string;
  targetPath: string;
  action: 'created' | 'updated' | 'skipped';
  contentLength: number;
}

export interface SyncResult {
  projectRoot: string;
  discovered: DiscoveredRules[];
  operations: SyncOperation[];
  summary: {
    totalDiscovered: number;
    totalSynced: number;
    byAgent: Record<string, number>;
  };
}
