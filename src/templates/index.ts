/**
 * 技能包模板市场
 *
 * 内置多套预设模板，针对不同文档类型使用不同的 LLM 提炼策略。
 * 用户也可通过 --template <name> 选择，或用 --list-templates 查看全部。
 */

export interface SkillTemplate {
  /** 模板唯一标识 */
  id: string;
  /** 展示名 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 适用的文档类型 */
  category: 'api' | 'coding' | 'project' | 'reference' | 'general';
  /** 适合的 Agent 类型（空数组 = 全部） */
  agents: string[];
  /** 额外的 Prompt 指令（追加到基础 prompt 之后） */
  promptSuffix: string;
  /** 建议的输出文件名 */
  suggestedFilename?: string;
}

// ═══════════════════════════════════════════════════════
// 内置模板
// ═══════════════════════════════════════════════════════

export const TEMPLATES: SkillTemplate[] = [
  {
    id: 'default',
    name: '默认模板',
    description: '通用文档提炼，平衡详细度与简洁性',
    category: 'general',
    agents: [],
    promptSuffix: '',
  },
  {
    id: 'api-doc',
    name: 'API 文档',
    description: '提取 API 端点、参数、请求/响应示例，适合 REST/GraphQL 文档',
    category: 'api',
    agents: ['codex', 'cursor'],
    promptSuffix: `Focus on:
- All API endpoints with HTTP method, path, and purpose
- Request parameters: name, type, required/optional, description
- Response structure and status codes
- Authentication requirements
- Rate limiting details
- Complete code examples for each endpoint
Group endpoints by resource/domain. Preserve exact parameter names and types.`,
    suggestedFilename: 'api-rules.md',
  },
  {
    id: 'coding-guide',
    name: '编码规范',
    description: '提取项目编码约定、命名规范、架构模式',
    category: 'coding',
    agents: ['cursor', 'claude'],
    promptSuffix: `Focus on:
- Naming conventions (variables, functions, files, classes)
- Code structure patterns and architecture decisions
- Import/export rules and module organization
- Error handling patterns
- Testing conventions
- Preferred libraries and utilities
Output as strict rules using "Always...", "Never...", "Prefer..." directives.`,
    suggestedFilename: 'coding-standards.md',
  },
  {
    id: 'project-rules',
    name: '项目规则',
    description: '提取项目构建命令、环境配置、目录结构',
    category: 'project',
    agents: ['codex', 'claude'],
    promptSuffix: `Focus on:
- Build commands and scripts (npm scripts, make targets, etc.)
- Environment setup and required env vars
- Directory structure and file organization conventions
- Git workflow and branch naming
- Deployment process
- Dependencies and their roles
Format as a quick-reference checklist.`,
    suggestedFilename: 'project-guide.md',
  },
  {
    id: 'cheatsheet',
    name: '速查表',
    description: '极简模式：只保留命令、语法、关键参数，去掉所有解释',
    category: 'reference',
    agents: [],
    promptSuffix: `Create an EXTREMELY concise cheatsheet:
- Only commands, syntax, and key parameters
- NO explanations, NO introductions, NO prose
- Use tables for parameter lists
- Group by feature/category
- Maximum density: every line must be useful
Think Unix man page density.`,
    suggestedFilename: 'cheatsheet.md',
  },
  {
    id: 'sdk-guide',
    name: 'SDK 指南',
    description: '提取 SDK 安装、初始化、核心用法、常见错误',
    category: 'api',
    agents: ['codex', 'cursor', 'claude'],
    promptSuffix: `Focus on:
- Installation steps (exact commands)
- Initialization code (exact imports and setup)
- Core methods with signatures and examples
- Common errors and their solutions
- Version compatibility notes
Preserve exact import paths and method names.`,
    suggestedFilename: 'sdk-guide.md',
  },
];

// ═══════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════

const TEMPLATE_MAP = new Map(TEMPLATES.map((t) => [t.id, t]));

/** 根据 ID 获取模板 */
export function getTemplate(id: string): SkillTemplate | undefined {
  return TEMPLATE_MAP.get(id);
}

/** 列出所有模板（用于 --list-templates） */
export function listTemplates(): SkillTemplate[] {
  return TEMPLATES;
}

/** 校验模板 ID */
export function isValidTemplate(id: string): boolean {
  return TEMPLATE_MAP.has(id);
}

/** 按分类列出模板 */
export function listTemplatesByCategory(): Record<string, SkillTemplate[]> {
  const grouped: Record<string, SkillTemplate[]> = {};
  for (const t of TEMPLATES) {
    if (!grouped[t.category]) grouped[t.category] = [];
    grouped[t.category].push(t);
  }
  return grouped;
}
