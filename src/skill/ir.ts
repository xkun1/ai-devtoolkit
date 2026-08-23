import { posix } from 'node:path';
import { parseDocument } from 'yaml';
import {
  extractDescription,
  normalizeSkillName,
} from '../format/frontmatter.js';
import { normalizeMarkdown } from '../format/normalize.js';
import type {
  CreateSkillIRInput,
  SkillIR,
  SkillMetadata,
  SkillResource,
} from './types.js';
import { SKILL_IR_VERSION } from './types.js';

const MAX_DESCRIPTION_LENGTH = 1024;
const MAX_COMPATIBILITY_LENGTH = 500;

/** 将任意规则正文规范化为平台无关的 Skill IR。 */
export function createSkillIR(input: CreateSkillIRInput): SkillIR {
  if (typeof input?.content !== 'string') {
    throw new TypeError('Skill content 必须是字符串');
  }
  const unwrapped = unwrapMarkdownFence(input.content);
  const embedded = extractEmbeddedFrontmatter(unwrapped);
  if (!embedded.body.trim()) {
    throw new Error('Skill instructions 不能为空');
  }
  const instructions = normalizeMarkdown(embedded.body);
  const title =
    readString(input.title)?.trim() ||
    instructions.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
    undefined;

  const embeddedName = readString(embedded.attributes.name);
  const embeddedDescription = readString(embedded.attributes.description);
  const name = normalizeSkillName(
    readString(input.name) ?? embeddedName ?? title ?? 'doc-skill',
  );
  const description = normalizeRequiredText(
    input.description ??
      embeddedDescription ??
      extractDescription(instructions, title || `${name} skill`),
    MAX_DESCRIPTION_LENGTH,
  );

  const metadata: SkillMetadata = {
    name,
    description,
  };

  const license = normalizeOptionalText(
    input.license ?? readString(embedded.attributes.license),
  );
  if (license) metadata.license = license;

  const compatibility = normalizeOptionalText(
    input.compatibility ?? readString(embedded.attributes.compatibility),
    MAX_COMPATIBILITY_LENGTH,
  );
  if (compatibility) metadata.compatibility = compatibility;

  const customMetadata = {
    ...readStringMap(embedded.attributes.metadata),
    ...readStringMap(input.metadata),
  };
  if (Object.keys(customMetadata).length > 0) {
    metadata.metadata = customMetadata;
  }

  const allowedTools = normalizeOptionalText(
    input.allowedTools ?? readString(embedded.attributes['allowed-tools']),
  );
  if (allowedTools) metadata.allowedTools = allowedTools;

  return {
    schemaVersion: SKILL_IR_VERSION,
    metadata,
    title,
    instructions,
    applicability: normalizeApplicability({
      globs:
        input.applicability?.globs ?? readStringList(embedded.attributes.globs),
      alwaysApply:
        input.applicability?.alwaysApply ??
        readBoolean(embedded.attributes.alwaysApply),
    }),
    resources: normalizeResources(
      Array.isArray(input.resources) ? input.resources : [],
    ),
    source: input.source,
  };
}

function extractEmbeddedFrontmatter(content: string): {
  attributes: Record<string, unknown>;
  body: string;
} {
  const normalized = content.replace(/\r\n?/g, '\n').trim();
  if (!normalized.startsWith('---\n')) {
    return { attributes: {}, body: normalized };
  }

  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) {
    throw new Error('技能内容包含未闭合的 YAML frontmatter');
  }

  const document = parseDocument(match[1], {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(
      `技能 YAML frontmatter 无效：${document.errors[0].message}`,
    );
  }

  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 20 });
  } catch (error: unknown) {
    throw new Error(
      `技能 YAML frontmatter 无效：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!isRecord(value)) {
    throw new Error('技能 YAML frontmatter 必须是键值映射');
  }
  return { attributes: value, body: match[2].trim() };
}

function normalizeResources(resources: readonly unknown[]): SkillResource[] {
  const seen = new Set<string>();
  return resources.map((resource) => {
    if (!isRecord(resource)) throw new Error('Skill 资源必须是对象');
    if (typeof resource.path !== 'string') {
      throw new Error('Skill 资源 path 必须是字符串');
    }
    if (typeof resource.content !== 'string') {
      throw new Error(`Skill 资源内容无效: ${resource.path}`);
    }
    if (!['reference', 'script', 'asset'].includes(String(resource.kind))) {
      throw new Error(`Skill 资源 kind 无效: ${resource.path}`);
    }
    const rawPath = resource.path.trim().replaceAll('\\', '/');
    const segments = rawPath.split('/');
    if (
      !rawPath ||
      rawPath.includes('\u0000') ||
      rawPath.endsWith('/') ||
      rawPath.startsWith('/') ||
      /^[a-z]:\//i.test(rawPath) ||
      segments.includes('..')
    ) {
      throw new Error(`Skill 资源路径不安全: ${resource.path}`);
    }
    const path = posix.normalize(rawPath).replace(/^\.\//, '');
    if (!path || path === '.' || path.toLowerCase() === 'skill.md') {
      throw new Error(`Skill 资源路径无效: ${resource.path}`);
    }
    if (seen.has(path)) throw new Error(`Skill 资源路径重复: ${path}`);
    seen.add(path);
    return {
      path,
      content: normalizeMarkdown(resource.content),
      kind: resource.kind as SkillResource['kind'],
    };
  });
}

function normalizeApplicability(
  applicability: CreateSkillIRInput['applicability'],
): CreateSkillIRInput['applicability'] {
  if (!isRecord(applicability)) return undefined;
  const globs = (
    Array.isArray(applicability.globs) ? applicability.globs : undefined
  )
    ?.filter((glob): glob is string => typeof glob === 'string')
    .map((glob) => glob.trim())
    .filter(Boolean);
  return {
    globs: globs?.length ? [...new Set(globs)] : undefined,
    alwaysApply:
      typeof applicability.alwaysApply === 'boolean'
        ? applicability.alwaysApply
        : undefined,
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function readStringList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter(
    (item): item is string => typeof item === 'string',
  );
  return strings.length > 0 ? strings : undefined;
}

function readStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item;
  }
  return result;
}

function normalizeRequiredText(value: unknown, maxLength: number): string {
  return normalizeOptionalText(value, maxLength) || '通用开发技能';
}

function normalizeOptionalText(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function unwrapMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  return match?.[1] ?? content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
