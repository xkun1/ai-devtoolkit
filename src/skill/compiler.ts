import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
} from 'node:path';
import type {
  AgentType,
  GeneratedArtifact,
  SkillResult,
} from '../types/index.js';
import { isAgentType } from '../agents.js';
import { normalizeMarkdown } from '../format/normalize.js';
import type {
  CompileSkillOptions,
  SkillIR,
  SkillMetadata,
  SkillResource,
} from './types.js';

/** 支持原生 Agent Skills 目录的平台映射。 */
export const AGENT_SKILL_ROOTS: Partial<Record<AgentType, string>> = {
  codex: join('.agents', 'skills'),
  claude: join('.claude', 'skills'),
  copilot: join('.github', 'skills'),
  gemini: join('.gemini', 'skills'),
};

const STANDARD_MAIN_MAX_LINES = 480;

export function isStandardSkillAgent(agentType: AgentType): boolean {
  return AGENT_SKILL_ROOTS[agentType] !== undefined;
}

/** 根据 IR 与平台适配器计算主文件路径。 */
export function resolveAgentPrimaryPath(
  agentType: AgentType,
  skillName: string,
  outputPath?: string,
  outputRoot = '.',
  outputMode: 'modern' | 'legacy' = 'modern',
): string {
  if (!isAgentType(agentType)) {
    throw new RangeError(`不支持的 Agent 类型: ${String(agentType)}`);
  }
  if (outputPath) return outputPath;
  assertPortableSkillName(skillName);

  let path: string;
  if (outputMode === 'legacy') {
    path = legacyPath(agentType);
  } else {
    const skillRoot = AGENT_SKILL_ROOTS[agentType];
    if (skillRoot) {
      path = join(skillRoot, skillName, 'SKILL.md');
    } else if (agentType === 'cursor') {
      path = join('.cursor', 'rules', `${skillName}.mdc`);
    } else if (agentType === 'windsurf') {
      path = join('.windsurf', 'rules', `${skillName}.md`);
    } else {
      path = 'CONVENTIONS.md';
    }
  }

  return outputRoot === '.' ? path : join(outputRoot, path);
}

/** 将统一 Skill IR 编译为指定 Agent 的最终产物。 */
export function compileSkill(
  ir: SkillIR,
  options: CompileSkillOptions,
): SkillResult {
  assertSkillMetadata(ir.metadata);
  if (typeof ir.instructions !== 'string' || !ir.instructions.trim()) {
    throw new TypeError('Skill instructions 不能为空');
  }
  if (!Array.isArray(ir.resources)) {
    throw new TypeError('Skill resources 必须是数组');
  }
  const mode = options.outputMode ?? 'modern';
  if (mode !== 'modern' && mode !== 'legacy') {
    throw new RangeError('outputMode 必须是 modern 或 legacy');
  }
  const primaryPath = resolveAgentPrimaryPath(
    options.agentType,
    ir.metadata.name,
    options.outputPath,
    options.outputRoot,
    mode,
  );

  if (
    mode === 'legacy' ||
    (options.outputPath &&
      shouldUseLegacySingleFile(options.agentType, primaryPath))
  ) {
    const content =
      options.agentType === 'codex'
        ? buildStandardSkillContent(ir.metadata, ir.instructions)
        : ir.instructions;
    return makeResult(options.agentType, [artifact(primaryPath, content)]);
  }

  if (isStandardSkillAgent(options.agentType)) {
    return makeResult(
      options.agentType,
      buildStandardSkillArtifacts(ir, primaryPath, !options.outputPath),
    );
  }

  if (options.agentType === 'cursor') {
    return makeResult(options.agentType, [
      artifact(primaryPath, buildCursorContent(ir)),
      ...buildResourceArtifacts(
        ir.resources,
        dirname(primaryPath),
        primaryPath,
      ),
    ]);
  }

  if (options.agentType === 'windsurf') {
    return makeResult(options.agentType, [
      artifact(primaryPath, buildWindsurfContent(ir)),
      ...buildResourceArtifacts(
        ir.resources,
        dirname(primaryPath),
        primaryPath,
      ),
    ]);
  }

  return makeResult(options.agentType, [
    artifact(primaryPath, ir.instructions),
    ...buildResourceArtifacts(ir.resources, dirname(primaryPath), primaryPath),
  ]);
}

export function renderSkillFrontmatter(metadata: SkillMetadata): string {
  assertSkillMetadata(metadata);
  const lines = [
    '---',
    `name: ${metadata.name}`,
    `description: ${yamlString(metadata.description)}`,
  ];
  if (metadata.license) {
    lines.push(`license: ${yamlString(metadata.license)}`);
  }
  if (metadata.compatibility) {
    lines.push(`compatibility: ${yamlString(metadata.compatibility)}`);
  }
  if (metadata.metadata && Object.keys(metadata.metadata).length > 0) {
    lines.push('metadata:');
    for (const [key, value] of Object.entries(metadata.metadata).sort(
      ([a], [b]) => a.localeCompare(b),
    )) {
      lines.push(`  ${yamlKey(key)}: ${yamlString(value)}`);
    }
  }
  if (metadata.allowedTools) {
    lines.push(`allowed-tools: ${yamlString(metadata.allowedTools)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildStandardSkillArtifacts(
  ir: SkillIR,
  primaryPath: string,
  allowSplit: boolean,
): GeneratedArtifact[] {
  const resources = buildResourceArtifacts(
    ir.resources,
    dirname(primaryPath),
    primaryPath,
  );
  const fullContent = buildStandardSkillContent(ir.metadata, ir.instructions);
  if (!allowSplit || lineCount(fullContent) <= STANDARD_MAIN_MAX_LINES) {
    return [artifact(primaryPath, fullContent), ...resources];
  }

  const parsed = parseMarkdownDocument(ir.instructions);
  if (parsed.sections.length < 2) {
    return [artifact(primaryPath, fullContent), ...resources];
  }

  const kept: MarkdownSection[] = [];
  const overflow: MarkdownSection[] = [];
  const frontmatterLines = lineCount(renderSkillFrontmatter(ir.metadata));
  let usedLines = frontmatterLines + lineCount(parsed.preamble) + 12;
  for (const section of parsed.sections) {
    const sectionLines = lineCount(section.content);
    if (
      overflow.length === 0 &&
      (kept.length === 0 ||
        usedLines + sectionLines <= STANDARD_MAIN_MAX_LINES - 12)
    ) {
      kept.push(section);
      usedLines += sectionLines;
    } else {
      overflow.push(section);
    }
  }

  if (overflow.length === 0) {
    return [artifact(primaryPath, fullContent), ...resources];
  }

  const usedResourcePaths = new Set(
    ir.resources.map((item) =>
      portablePathKey(normalizeSafeResourcePath(item.path)),
    ),
  );
  const detailResourcePath = resolveDetailResourcePath(usedResourcePaths);
  const referencePath = join(dirname(primaryPath), detailResourcePath);
  const link = toRelativeMarkdownPath(primaryPath, referencePath);
  const index = `## 详细参考

需要完整 API、命令、边界条件或扩展示例时，读取 [详细参考](${link})。`;
  const primaryBody = [
    parsed.preamble,
    ...kept.map((section) => section.content),
    index,
  ]
    .filter(Boolean)
    .join('\n\n');
  const reference = `# ${ir.title || ir.metadata.name} - 详细参考

${overflow.map((section) => section.content).join('\n\n')}`;

  return [
    artifact(primaryPath, buildStandardSkillContent(ir.metadata, primaryBody)),
    artifact(referencePath, reference, 'reference'),
    ...resources,
  ];
}

function buildStandardSkillContent(
  metadata: SkillMetadata,
  instructions: string,
): string {
  return normalizeMarkdown(
    `${renderSkillFrontmatter(metadata)}\n\n${instructions.trim()}`,
  );
}

function buildCursorContent(ir: SkillIR): string {
  const globs = ir.applicability?.globs?.length
    ? ir.applicability.globs
    : ['**/*'];
  const globsValue =
    globs.length === 1
      ? yamlString(globs[0])
      : `[${globs.map((glob) => yamlString(glob)).join(', ')}]`;
  return normalizeMarkdown(`---
description: ${yamlString(ir.metadata.description)}
globs: ${globsValue}
alwaysApply: ${ir.applicability?.alwaysApply ?? false}
---

${ir.instructions.trim()}`);
}

function buildWindsurfContent(ir: SkillIR): string {
  return normalizeMarkdown(`---
description: ${yamlString(ir.metadata.description)}
---

${ir.instructions.trim()}`);
}

function buildResourceArtifacts(
  resources: SkillResource[],
  skillDirectory: string,
  primaryPath: string,
): GeneratedArtifact[] {
  const seen = new Set<string>();
  return resources.map((resource) => {
    const resourcePath = normalizeSafeResourcePath(resource.path);
    const pathKey = portablePathKey(resourcePath);
    if (seen.has(pathKey)) {
      throw new Error(`Skill 资源路径重复: ${resource.path}`);
    }
    seen.add(pathKey);
    if (typeof resource.content !== 'string') {
      throw new TypeError(`Skill 资源内容无效: ${resource.path}`);
    }
    if (!['reference', 'script', 'asset'].includes(resource.kind)) {
      throw new TypeError(`Skill 资源 kind 无效: ${resource.path}`);
    }
    const artifactPath = join(skillDirectory, resourcePath);
    if (samePath(artifactPath, primaryPath)) {
      throw new Error(`Skill 资源不能覆盖主文件: ${resource.path}`);
    }
    return artifact(artifactPath, resource.content, resource.kind);
  });
}

function resolveDetailResourcePath(usedPaths: Set<string>): string {
  const preferred = 'references/details.md';
  if (!usedPaths.has(portablePathKey(preferred))) return preferred;
  let index = 2;
  while (usedPaths.has(portablePathKey(`references/details-${index}.md`)))
    index++;
  return `references/details-${index}.md`;
}

function legacyPath(agentType: AgentType): string {
  if (agentType === 'codex') return 'SKILL.md';
  if (agentType === 'cursor') return '.cursorrules';
  if (agentType === 'windsurf') return '.windsurfrules';
  if (agentType === 'copilot') return 'copilot-instructions.md';
  if (agentType === 'gemini') return 'GEMINI.md';
  if (agentType === 'aider') return 'CONVENTIONS.md';
  return 'CLAUDE.md';
}

function shouldUseLegacySingleFile(
  agentType: AgentType,
  path: string,
): boolean {
  const filename = basename(path).toLowerCase();
  if (agentType === 'cursor') return filename === '.cursorrules';
  if (agentType === 'windsurf') return filename === '.windsurfrules';
  if (agentType === 'codex') return false;
  if (isStandardSkillAgent(agentType)) return filename !== 'skill.md';
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

function lineCount(content: string): number {
  return content.length ? content.split(/\r?\n/).length : 0;
}

function yamlString(value: string): string {
  return JSON.stringify(value);
}

function yamlKey(value: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(value) ? value : JSON.stringify(value);
}

function assertSkillMetadata(metadata: SkillMetadata): void {
  assertPortableSkillName(metadata?.name);
  if (
    typeof metadata.description !== 'string' ||
    metadata.description.trim().length === 0 ||
    metadata.description.length > 1024
  ) {
    throw new RangeError('Skill description 必须是 1-1024 个字符');
  }
  if (metadata.license !== undefined && !isNonEmptyString(metadata.license)) {
    throw new TypeError('Skill license 必须是非空字符串');
  }
  if (
    metadata.compatibility !== undefined &&
    (!isNonEmptyString(metadata.compatibility) ||
      metadata.compatibility.length > 500)
  ) {
    throw new RangeError('Skill compatibility 必须是 1-500 个字符');
  }
  if (
    metadata.allowedTools !== undefined &&
    !isNonEmptyString(metadata.allowedTools)
  ) {
    throw new TypeError('Skill allowed-tools 必须是非空字符串');
  }
  if (metadata.metadata !== undefined) {
    if (
      typeof metadata.metadata !== 'object' ||
      metadata.metadata === null ||
      Array.isArray(metadata.metadata)
    ) {
      throw new TypeError('Skill metadata 必须是字符串键值映射');
    }
    for (const value of Object.values(metadata.metadata)) {
      if (typeof value !== 'string') {
        throw new TypeError('Skill metadata 的值必须是字符串');
      }
    }
  }
}

function assertPortableSkillName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > 64 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)
  ) {
    throw new RangeError('Skill name 必须是 1-64 位小写字母、数字或单连字符');
  }
}

function normalizeSafeResourcePath(path: unknown): string {
  if (typeof path !== 'string') {
    throw new TypeError('Skill 资源路径必须是字符串');
  }
  const normalized = path.replaceAll('\\', '/');
  if (
    !normalized ||
    normalized === '.' ||
    normalized.includes('\u0000') ||
    normalized.endsWith('/') ||
    isAbsolute(normalized) ||
    /^[a-z]:\//i.test(normalized) ||
    normalized.split('/').includes('..') ||
    normalized.toLowerCase() === 'skill.md'
  ) {
    throw new Error(`Skill 资源路径不安全: ${path}`);
  }
  return posix.normalize(normalized).replace(/^\.\//, '');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function portablePathKey(path: string): string {
  return path.toLowerCase();
}

function toRelativeMarkdownPath(from: string, to: string): string {
  return relative(dirname(from), to).replaceAll('\\', '/');
}

/** 返回主文件名，用于调用侧无需重复 Node path 逻辑。 */
export function isSkillFilePath(path: string): boolean {
  return basename(path).toLowerCase() === 'skill.md';
}
