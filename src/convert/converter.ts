/**
 * 跨 Agent 规则转换器
 *
 * 将不同 Agent 的规则格式无损转化为目标 Agent 官方标准结构。
 */
import { join } from 'node:path';
import type { GeneratedArtifact } from '../types/index.js';
import type { ConvertOptions, ConvertResult, ParsedRule } from './types.js';
import { parseRule } from './parser.js';
import {
  slugify,
  normalizeSkillName,
  extractDescription,
} from '../format/frontmatter.js';

const CODEX_MAX_LINES = 360;
const CLAUDE_MAX_LINES = 200;

/** 将规则内容或已解析规则转化为目标 Agent 结构 */
export function convertRule(
  source: ParsedRule | string,
  options: ConvertOptions,
): ConvertResult {
  const parsed = typeof source === 'string' ? parseRule(source) : source;
  const targetAgent = options.to;
  const name =
    options.name || parsed.meta.name || slugify(parsed.title || 'custom-rule');
  const slug = normalizeSkillName(name);

  let artifacts: GeneratedArtifact[];

  switch (targetAgent) {
    case 'cursor':
      artifacts = convertToCursor(parsed, slug, options);
      break;
    case 'codex':
      artifacts = convertToCodex(parsed, slug, options);
      break;
    case 'claude':
      artifacts = convertToClaude(parsed, slug, options);
      break;
    default:
      throw new Error(`不支持的目标 Agent 类型: ${targetAgent}`);
  }

  return {
    from: parsed.format,
    to: targetAgent,
    parsed,
    artifacts,
  };
}

/** 转换为 Cursor .cursor/rules/<name>.mdc 格式 */
function convertToCursor(
  parsed: ParsedRule,
  slug: string,
  options: ConvertOptions,
): GeneratedArtifact[] {
  const outputDir = options.outputDir || '.';
  const path = join(outputDir, '.cursor', 'rules', `${slug}.mdc`);

  const desc = parsed.meta.description || parsed.title || '项目开发规则';
  const globs =
    parsed.meta.globs && parsed.meta.globs.length > 0
      ? parsed.meta.globs
      : ['**/*'];
  const alwaysApply = parsed.meta.alwaysApply ?? false;

  const globsStr =
    globs.length === 1
      ? `"${globs[0]}"`
      : `[${globs.map((g) => `"${g}"`).join(', ')}]`;

  const mdcContent = `---
description: "${yamlEscape(desc)}"
globs: ${globsStr}
alwaysApply: ${alwaysApply}
---

${parsed.body.trim()}
`;

  return [{ path, content: mdcContent, kind: 'primary' }];
}

/** 转换为 Codex .agents/skills/<name>/SKILL.md 格式 */
function convertToCodex(
  parsed: ParsedRule,
  slug: string,
  options: ConvertOptions,
): GeneratedArtifact[] {
  const outputDir = options.outputDir || '.';
  const primaryPath = join(outputDir, '.agents', 'skills', slug, 'SKILL.md');

  const desc =
    parsed.meta.description ||
    parsed.title ||
    extractDescription(parsed.body, '通用技能');
  const skillName = normalizeSkillName(parsed.meta.name || slug);

  const fullContent = `---
name: ${skillName}
description: "${yamlEscape(desc)}"
---

${parsed.body.trim()}
`;

  // 超长内容渐进披露拆分
  const lines = fullContent.split('\n');
  if (lines.length <= CODEX_MAX_LINES) {
    return [{ path: primaryPath, content: fullContent, kind: 'primary' }];
  }

  const sections = parseSections(parsed.body);
  if (sections.length < 2) {
    return [{ path: primaryPath, content: fullContent, kind: 'primary' }];
  }

  const kept: string[] = [];
  const overflow: string[] = [];
  let usedLines = 6; // Frontmatter 行数

  for (const sec of sections) {
    const secLines = sec.split('\n').length;
    if (
      overflow.length === 0 &&
      (kept.length === 0 || usedLines + secLines <= CODEX_MAX_LINES - 20)
    ) {
      kept.push(sec);
      usedLines += secLines;
    } else {
      overflow.push(sec);
    }
  }

  const referencePath = join(
    outputDir,
    '.agents',
    'skills',
    slug,
    'references',
    'details.md',
  );
  const primaryText = `---
name: ${skillName}
description: "${yamlEscape(desc)}"
---

${kept.join('\n\n')}

## 详细参考

需要完整 API、命令或扩展示例时，读取 [详细参考](references/details.md)。
`;

  const refText = `# ${parsed.title || skillName} - 详细参考

${overflow.join('\n\n')}
`;

  return [
    { path: primaryPath, content: primaryText, kind: 'primary' },
    { path: referencePath, content: refText, kind: 'reference' },
  ];
}

/** 转换为 Claude CLAUDE.md 或 .claude/rules/<name>.md 格式 */
function convertToClaude(
  parsed: ParsedRule,
  slug: string,
  options: ConvertOptions,
): GeneratedArtifact[] {
  const outputDir = options.outputDir || '.';
  const lines = parsed.body.split('\n').length;

  if (lines <= CLAUDE_MAX_LINES) {
    const path = join(outputDir, 'CLAUDE.md');
    const content = parsed.body.startsWith('#')
      ? parsed.body.trim() + '\n'
      : `# ${parsed.title || parsed.meta.name || '项目规则'}\n\n${parsed.body.trim()}\n`;
    return [{ path, content, kind: 'primary' }];
  }

  const rulePath = join(outputDir, '.claude', 'rules', `${slug}.md`);
  const claudePath = join(outputDir, 'CLAUDE.md');
  const title = parsed.title || parsed.meta.name || '项目规则';

  const claudeMain =
    '# ' +
    title +
    '\n\n详细项目规则已拆分到 `.claude/rules/' +
    slug +
    '.md`；Claude Code 会自动加载 `.claude/rules/` 下的规则。\n';
  return [
    { path: claudePath, content: claudeMain, kind: 'primary' },
    { path: rulePath, content: parsed.body.trim() + '\n', kind: 'rule' },
  ];
}

function parseSections(content: string): string[] {
  const matches = [...content.matchAll(/^##\s+.+$/gm)];
  if (!matches.length) return [content];
  const first = matches[0].index ?? 0;
  const preamble = content.slice(0, first).trim();
  const list: string[] = [];
  if (preamble) list.push(preamble);

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? 0;
    const end = matches[i + 1]?.index ?? content.length;
    list.push(content.slice(start, end).trim());
  }
  return list;
}

function yamlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
