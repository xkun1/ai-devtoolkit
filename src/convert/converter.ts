/**
 * 跨 Agent 规则转换器。
 *
 * 所有来源先规范化为统一 Skill IR，再交由平台编译器输出，避免生成链路与
 * 规则互转链路各自维护一套格式逻辑。
 */
import type { ConvertOptions, ConvertResult, ParsedRule } from './types.js';
import { parseRule } from './parser.js';
import { slugify } from '../format/frontmatter.js';
import { createSkillIR } from '../skill/ir.js';
import { compileSkill } from '../skill/compiler.js';

/** 将规则内容或已解析规则转化为目标 Agent 标准结构。 */
export function convertRule(
  source: ParsedRule | string,
  options: ConvertOptions,
): ConvertResult {
  const parsed = typeof source === 'string' ? parseRule(source) : source;
  const name =
    options.name || parsed.meta.name || slugify(parsed.title || 'custom-rule');
  const ir = createSkillIR({
    content: parsed.rawContent,
    name,
    title: parsed.title,
    applicability: {
      globs: parsed.meta.globs,
      alwaysApply: parsed.meta.alwaysApply,
    },
    resources: parsed.references?.map((reference) => ({
      path: reference.path,
      content: reference.content,
      kind: 'reference' as const,
    })),
    source: parsed.sourcePath
      ? { source: parsed.sourcePath, title: parsed.title }
      : undefined,
  });
  const result = compileSkill(ir, {
    agentType: options.to,
    outputRoot: options.outputDir || '.',
  });

  return {
    from: parsed.format,
    to: options.to,
    parsed,
    artifacts: result.artifacts ?? [],
  };
}
