import type {
  AgentType,
  LoadedDocument,
  OutputMode,
  SkillResult,
} from '../types/index.js';
import { normalizeSkillName, slugify } from './frontmatter.js';
import { createSkillIR } from '../skill/ir.js';
import { compileSkill, resolveAgentPrimaryPath } from '../skill/compiler.js';

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
  const skillName = resolveSlug(doc, name);
  return resolveAgentPrimaryPath(
    agentType,
    skillName,
    outputPath,
    '.',
    outputMode,
  );
}

/** 先建立统一 Skill IR，再通过目标 Agent 适配器编译产物。 */
export function buildArtifacts(options: ArtifactOptions): SkillResult {
  const h1 = options.doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const ir = createSkillIR({
    content: options.content,
    // 与 resolvePrimaryPath 使用同一名称来源，避免模型意外输出的
    // frontmatter 改变落盘目录并破坏增量缓存命中。
    name: resolveSlug(options.doc, options.name),
    title: h1 || options.doc.title,
    description: options.doc.meta?.description,
    source: {
      source: options.doc.source,
      type: options.doc.type,
      title: options.doc.title,
      url: options.doc.url,
    },
  });
  return compileSkill(ir, {
    agentType: options.agentType,
    outputPath: options.outputPath,
    outputMode: options.outputMode,
  });
}

function resolveSlug(
  doc: Pick<LoadedDocument, 'content' | 'title'>,
  name?: string,
): string {
  if (name !== undefined) return normalizeSkillName(name);
  const h1 = doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return slugify(h1 || doc.title || 'doc-skill');
}
