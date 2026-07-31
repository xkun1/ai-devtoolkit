import type { LoadedDocument, LLMConfig, AgentType } from '../types/index.js';
import { callLLM } from './llm.js';
import { buildPrompt } from './prompts.js';

/** 用 LLM 将原始文档提炼为结构化技能知识 */
export async function transformToSkill(
  doc: LoadedDocument,
  config: LLMConfig,
  agentType: AgentType,
  name?: string,
): Promise<string> {
  const prompt = buildPrompt(doc, agentType, name);
  return callLLM(prompt, config);
}

export { buildPrompt, callLLM };
