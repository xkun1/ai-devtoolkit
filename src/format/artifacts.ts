import { dirname, relative, join } from 'node:path';
import type {
  AgentType,
  GeneratedArtifact,
  LoadedDocument,
  OutputMode,
  SkillResult,
} from '../types/index.js';
import {
  extractDescription,
  injectSkillFrontmatter,
  normalizeSkillName,
  slugify,
} from './frontmatter.js';

const CODEX_MAIN_MAX_LINES = 360;
const CLAUDE_MAIN_MAX_LINES = 200;

export interface ArtifactOptions {
  agentType: AgentType;
  content: string;
  doc: LoadedDocument;
  name?: string;
  outputPath?: string;
  outputMode?: OutputMode;
}

/** 根据源标题与目标 Agent 预估主文件路径，供缓存命中检查使用。 */
export function resolvePrimaryPath(
  agentType: AgentType,
  doc: Pick<LoadedDocument, 'content' | 'title'>,
  name?: string,
  outputPath?: string,
  outputMode: OutputMode = 'modern',
): string {
  if (outputPath) return outputPath;
  if (outputMode === 'legacy') return legacyPath(agentType);
  const slug = resolveSlug(doc, name);
  if (agentType === 'codex') return join('.agents', 'skills', slug, 'SKILL.md');
  if (agentType === 'cursor') return join('.cursor', 'rules', `${slug}.mdc`);
  return 'CLAUDE.md';
}

/** 把 LLM Markdown 规范化为各 Agent 当前推荐的文件结构。 */
export function buildArtifacts(options: ArtifactOptions): SkillResult {
  const mode = options.outputMode ?? 'modern';
  const primaryPath = resolvePrimaryPath(
    options.agentType,
    options.doc,
    options.name,
    options.outputPath,
    mode,
  );
  const cleanContent = normalizeMarkdown(unwrapMarkdownFence(options.content));

  if (mode === 'legacy') {
    const content =
      options.agentType === 'codex'
        ? injectSkillFrontmatter(cleanContent, frontmatterInput(options))
        : cleanContent;
    return makeResult(options.agentType, [artifact(primaryPath, content)]);
  }

  // 显式指定旧版文件名时按兼容单文件处理，避免悄悄改变用户要求的格式。
  if (
    options.outputPath &&
    (isLegacyFilename(options.agentType, primaryPath) ||
      options.agentType === 'codex')
  ) {
    const content =
      options.agentType === 'codex'
        ? injectSkillFrontmatter(cleanContent, frontmatterInput(options))
        : cleanContent;
    return makeResult(options.agentType, [artifact(primaryPath, content)]);
  }

  if (options.agentType === 'codex') {
    return makeResult(
      options.agentType,
      buildCodexArtifacts(cleanContent, primaryPath, options),
    );
  }
  if (options.agentType === 'cursor') {
    return makeResult(options.agentType, [
      artifact(
        primaryPath,
        primaryPath.endsWith('.mdc')
          ? injectCursorFrontmatter(cleanContent, options)
          : cleanContent,
      ),
    ]);
  }
  return makeResult(
    options.agentType,
    buildClaudeArtifacts(cleanContent, primaryPath, options),
  );
}

function buildCodexArtifacts(
  content: string,
  primaryPath: string,
  options: ArtifactOptions,
): GeneratedArtifact[] {
  const withFrontmatter = injectSkillFrontmatter(
    content,
    frontmatterInput(options),
  );
  if (lineCount(withFrontmatter) <= CODEX_MAIN_MAX_LINES) {
    return [artifact(primaryPath, withFrontmatter)];
  }

  const parsed = parseMarkdownDocument(withFrontmatter);
  if (parsed.sections.length < 2) {
    return [artifact(primaryPath, withFrontmatter)];
  }

  const kept: MarkdownSection[] = [];
  const overflow: MarkdownSection[] = [];
  let usedLines = lineCount(parsed.preamble);
  for (const section of parsed.sections) {
    const sectionLines = lineCount(section.content);
    if (
      !overflow.length &&
      (kept.length === 0 ||
        usedLines + sectionLines <= CODEX_MAIN_MAX_LINES - 20)
    ) {
      kept.push(section);
      usedLines += sectionLines;
    } else {
      overflow.push(section);
    }
  }

  if (!overflow.length) return [artifact(primaryPath, withFrontmatter)];

  const referencePath = join(dirname(primaryPath), 'references', 'details.md');
  const link = toRelativeMarkdownPath(primaryPath, referencePath);
  const index = [
    '## 详细参考',
    '',
    `需要完整 API、命令、边界条件或扩展示例时，读取 [详细参考](${link})。`,
  ].join('\n');
  const primary = normalizeMarkdown(
    [parsed.preamble, ...kept.map((section) => section.content), index].join(
      '\n\n',
    ),
  );
  const reference = normalizeMarkdown(
    [`# 详细参考`, ...overflow.map((section) => section.content)].join('\n\n'),
  );
  return [
    artifact(primaryPath, primary),
    artifact(referencePath, reference, 'reference'),
  ];
}

function buildClaudeArtifacts(
  content: string,
  primaryPath: string,
  options: ArtifactOptions,
): GeneratedArtifact[] {
  if (lineCount(content) <= CLAUDE_MAIN_MAX_LINES) {
    return [artifact(primaryPath, content)];
  }

  const slug = resolveSlug(options.doc, options.name);
  const rulePath = join(dirname(primaryPath), '.claude', 'rules', `${slug}.md`);
  const title =
    options.doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    options.doc.title ||
    '项目规则';
  const main = normalizeMarkdown(`# ${title}

详细项目规则已拆分到 \`${toRelativeMarkdownPath(primaryPath, rulePath)}\`；Claude Code 会自动加载 \`.claude/rules/\` 下的规则。`);
  return [artifact(primaryPath, main), artifact(rulePath, content, 'rule')];
}

function injectCursorFrontmatter(
  content: string,
  options: ArtifactOptions,
): string {
  if (/^---\r?\n/.test(content)) return content;
  const description =
    options.doc.meta?.description ||
    extractDescription(content, options.doc.title || '项目编码规则');
  return normalizeMarkdown(`---
description: "${yamlEscape(description)}"
globs: "**/*"
alwaysApply: false
---

${content}`);
}

function frontmatterInput(options: ArtifactOptions) {
  const h1 = options.doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: options.name,
    title: h1 || options.doc.title,
    description: options.doc.meta?.description,
  };
}

function resolveSlug(
  doc: Pick<LoadedDocument, 'content' | 'title'>,
  name?: string,
): string {
  if (name !== undefined) return normalizeSkillName(name);
  const h1 = doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return slugify(h1 || doc.title || 'doc-skill');
}

function legacyPath(agentType: AgentType): string {
  if (agentType === 'codex') return 'SKILL.md';
  if (agentType === 'cursor') return '.cursorrules';
  return 'CLAUDE.md';
}

function isLegacyFilename(agentType: AgentType, path: string): boolean {
  const file = path.replaceAll('\\', '/').split('/').pop();
  if (agentType === 'cursor') return file === '.cursorrules';
  return false;
}

function artifact(
  path: string,
  content: string,
  kind: GeneratedArtifact['kind'] = 'primary',
): GeneratedArtifact {
  return { path, content: normalizeMarkdown(content), kind };
}

function makeResult(
  agentType: AgentType,
  artifacts: GeneratedArtifact[],
): SkillResult {
  const primary = artifacts[0];
  return {
    agentType,
    content: primary.content,
    suggestedPath: primary.path,
    artifacts,
  };
}

interface MarkdownSection {
  content: string;
}

function parseMarkdownDocument(content: string): {
  preamble: string;
  sections: MarkdownSection[];
} {
  const matches = [...content.matchAll(/^##\s+.+$/gm)];
  if (!matches.length) return { preamble: content, sections: [] };
  const first = matches[0].index ?? 0;
  return {
    preamble: content.slice(0, first).trim(),
    sections: matches.map((match, index) => ({
      content: content
        .slice(match.index ?? 0, matches[index + 1]?.index ?? content.length)
        .trim(),
    })),
  };
}

function normalizeMarkdown(content: string): string {
  return content.replace(/\n{3,}$/g, '\n\n').trim() + '\n';
}

function unwrapMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? content;
}

function lineCount(content: string): number {
  return content.length ? content.split(/\r?\n/).length : 0;
}

function yamlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function toRelativeMarkdownPath(from: string, to: string): string {
  return relative(dirname(from), to).replaceAll('\\', '/');
}
