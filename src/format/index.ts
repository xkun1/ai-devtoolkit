import type { AgentType, SkillResult } from '../types/index.js';
import { isAgentType } from '../agents.js';
import { normalizeMarkdown } from './normalize.js';
export { buildArtifacts, resolvePrimaryPath } from './artifacts.js';

/** `formatResult` 兼容单文件 API 的默认路径；modern 目录由 Skill 编译器计算。 */
export const DEFAULT_OUTPUT_PATHS: Record<AgentType, string> = {
  codex: './SKILL.md',
  cursor: './.cursorrules',
  claude: './CLAUDE.md',
  windsurf: './.windsurf/rules/default.md',
  copilot: './.github/copilot-instructions.md',
  gemini: './GEMINI.md',
  aider: './CONVENTIONS.md',
};

/** 格式化最终结果 */
export function formatResult(
  content: string,
  agentType: AgentType,
  outputPath?: string,
): SkillResult {
  const path = outputPath || DEFAULT_OUTPUT_PATHS[agentType];
  return {
    agentType,
    content: normalizeMarkdown(content),
    suggestedPath: path,
  };
}

/** 校验 AgentType */
export function isValidAgentType(value: string): value is AgentType {
  return isAgentType(value);
}
