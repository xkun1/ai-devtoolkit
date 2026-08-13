import type { AgentType, SkillResult } from '../types/index.js';
export { buildArtifacts, resolvePrimaryPath } from './artifacts.js';

/** 默认输出路径 */
export const DEFAULT_OUTPUT_PATHS: Record<AgentType, string> = {
  codex: './SKILL.md',
  cursor: './.cursorrules',
  claude: './CLAUDE.md',
};

/** 格式化最终结果 */
export function formatResult(
  content: string,
  agentType: AgentType,
  outputPath?: string,
): SkillResult {
  const path = outputPath || DEFAULT_OUTPUT_PATHS[agentType];
  // 确保内容以单个换行结尾
  const cleanContent = content.replace(/\n{3,}$/g, '\n\n').trim() + '\n';
  return {
    agentType,
    content: cleanContent,
    suggestedPath: path,
  };
}

/** 校验 AgentType */
export function isValidAgentType(value: string): value is AgentType {
  return ['codex', 'cursor', 'claude'].includes(value);
}
