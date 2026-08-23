/** 所有受支持 Agent 的单一事实来源。 */
export const AGENT_TYPES = [
  'codex',
  'cursor',
  'claude',
  'windsurf',
  'copilot',
  'gemini',
  'aider',
] as const;

export type AgentType = (typeof AGENT_TYPES)[number];

export const AGENT_TYPE_HELP = AGENT_TYPES.join(', ');

export function isAgentType(value: unknown): value is AgentType {
  return (
    typeof value === 'string' &&
    (AGENT_TYPES as readonly string[]).includes(value)
  );
}
