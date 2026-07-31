import type { LoadedDocument, AgentType } from '../types/index.js';
import type { SkillTemplate } from '../templates/index.js';

const MAX_INPUT_CHARS = 60000;

/** 根据目标 Agent 构建专属提炼 Prompt */
export function buildPrompt(
  doc: LoadedDocument,
  agentType: AgentType,
  name?: string,
  template?: SkillTemplate,
): string {
  // 超长文档截断（保留头尾，中间省略）
  const content = truncateContent(doc.content);
  const title = doc.title || 'Untitled';
  const source = doc.url || doc.source;

  const templates: Record<AgentType, string> = {
    codex: buildCodexPrompt(content, title, source),
    cursor: buildCursorPrompt(content, title, source),
    claude: buildClaudePrompt(content, title, source),
  };

  let prompt = templates[agentType];
  // 自定义技能名：作为最高优先级指令追加到末尾
  if (name) {
    prompt += `\n\n## IMPORTANT\nThe skill name MUST be exactly "${name}". Use it as the top-level title / skill identifier, do not invent another name.`;
  }
  // 模板策略：追加模板专属提炼指令
  if (template && template.promptSuffix) {
    prompt += `\n\n## Additional Instructions\n${template.promptSuffix}`;
  }
  return prompt;
}

function truncateContent(text: string): string {
  if (text.length <= MAX_INPUT_CHARS) return text;
  const half = MAX_INPUT_CHARS / 2;
  return (
    text.slice(0, half) +
    `\n\n[... 中间内容已省略，原文共 ${text.length} 字符 ...]\n\n` +
    text.slice(-half)
  );
}

// ═══════════════════════════════════════════════════════
// Codex SKILL.md 模板
// ═══════════════════════════════════════════════════════
function buildCodexPrompt(
  content: string,
  title: string,
  source: string,
): string {
  return `You are creating a Codex Agent SKILL.md file.

Below is technical documentation about "${title}" (source: ${source}).
Your job: distill it into a high-quality, actionable SKILL.md that a Codex AI agent can load and follow.

## Rules
1. Start with a one-line description (what this skill does, when to use it)
2. Extract only ACTIONABLE knowledge: commands, APIs, patterns, conventions, gotchas
3. Use imperative mood and be concise — agents follow direct instructions
4. Preserve all code examples, CLI commands, and API signatures EXACTLY
5. Remove marketing fluff, introductions, and redundant explanations
6. Structure with clear ## headers, use bullet points and code blocks
7. If there are version-specific notes or breaking changes, highlight them
8. Keep the SAME language as the source document
9. Output ONLY valid Markdown, no wrapper comments

## Output Format
\`\`\`markdown
# <Skill Name>

<One sentence: what this skill enables + when to use it>

## <Key Section>
- <Actionable point>
- <Command/pattern with example>

## <Another Section>
...
\`\`\`

## Source Document
---
${content}
---`;
}

// ═══════════════════════════════════════════════════════
// Cursor .cursorrules 模板
// ═══════════════════════════════════════════════════════
function buildCursorPrompt(
  content: string,
  title: string,
  source: string,
): string {
  return `You are creating a .cursorrules file for the Cursor AI editor.

Below is technical documentation about "${title}" (source: ${source}).
Your job: distill it into a .cursorrules file that guides Cursor's code generation.

## Rules
1. .cursorrules is project-level context injected into every prompt — be precise
2. Focus on: coding conventions, API usage patterns, import styles, common pitfalls
3. Use directive language: "Always use...", "Never...", "Prefer..."
4. Include concrete code snippets that demonstrate correct usage
5. Preserve exact API signatures, type names, and import paths
6. Keep it under 3000 tokens — Cursor truncates overly long rules
7. Group related rules under ## headers
8. Keep the SAME language as the source document
9. Output ONLY the rules content, no explanations

## Output Format
\`\`\`
You are an expert in ${title}. Follow these rules:

## <Category>
- <Rule with rationale>
- <Code example>

## <Category>
...
\`\`\`

## Source Document
---
${content}
---`;
}

// ═══════════════════════════════════════════════════════
// Claude CLAUDE.md 模板
// ═══════════════════════════════════════════════════════
function buildClaudePrompt(
  content: string,
  title: string,
  source: string,
): string {
  return `You are creating a CLAUDE.md file for Claude Code.

Below is technical documentation about "${title}" (source: ${source}).
Your job: distill it into a CLAUDE.md project memory file that Claude Code uses for context.

## Rules
1. CLAUDE.md is Claude Code's persistent project memory — write clear guidance
2. Structure: Overview → Setup → Conventions → Commands → Gotchas
3. Extract: build commands, test commands, project structure, key conventions
4. Be factual and reference-oriented (not tutorial-style)
5. Use \`##\` headers and keep sections scannable
6. Include any environment setup, env vars, or prerequisites
7. Preserve exact command syntax and config values
8. Keep the SAME language as the source document
9. Output ONLY the CLAUDE.md content

## Output Format
\`\`\`markdown
# ${title}

## Overview
<2-3 sentences>

## Setup
\`\`\`bash
<install/setup commands>
\`\`\`

## Conventions
- <Convention>

## Commands
- \`<command>\` — <description>

## Gotchas
- <Pitfall to avoid>
\`\`\`

## Source Document
---
${content}
---`;
}
