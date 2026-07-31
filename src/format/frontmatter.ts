/** Codex SKILL.md frontmatter 工具：slug 生成、描述提取、frontmatter 注入 */

export interface FrontmatterInput {
  /** 用户指定的技能名（最高优先级） */
  name?: string;
  /** 文档标题（用于生成默认 name / description 的回退值） */
  title?: string;
  /** 文档描述（来自加载器 meta，优先于自动提取） */
  description?: string;
}

/** 默认技能名：标题无法转为合法 slug 时回退 */
const DEFAULT_SKILL_NAME = 'doc-skill';

/**
 * 将文本转为合法技能名 slug：
 * 小写 → 非字母数字字符折叠为连字符 → 去首尾连字符 → 截断 64 字符。
 * 纯中文等无法产生 ASCII slug 的输入回退到默认值。
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/g, ''); // 截断后可能留下尾部连字符
  return slug || DEFAULT_SKILL_NAME;
}

/** 清理行内 markdown 标记：加粗/斜体/代码/链接/删除线符号 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/[*_`~[\]()#>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 从 Markdown 内容提取描述：
 * 优先第一个 # 标题，否则首个非空行；清理 markdown 符号。
 * 提取不到时回退 fallback。
 */
export function extractDescription(content: string, fallback: string): string {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1?.[1]) {
    const desc = stripInlineMarkdown(h1[1]);
    if (desc) return desc;
  }
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (firstLine) {
    const desc = stripInlineMarkdown(firstLine);
    if (desc) return desc;
  }
  return fallback;
}

/** 判断内容是否以 YAML frontmatter 开头（正文中间的 --- 不算） */
export function hasFrontmatter(content: string): boolean {
  return /^---\r?\n[\s\S]*?\r?\n---/.test(content);
}

/** 转义 YAML 双引号字符串中的特殊字符 */
function yamlEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 为 SKILL.md 注入 YAML frontmatter（name + description）。
 * 已有 frontmatter 的内容保留原样，不覆盖。
 */
export function injectSkillFrontmatter(
  content: string,
  input: FrontmatterInput,
): string {
  if (hasFrontmatter(content)) return content;

  const name =
    input.name ?? slugify(input.title ?? extractDescription(content, ''));
  const description =
    input.description ?? extractDescription(content, input.title ?? '');

  const lines = [`name: ${name}`];
  if (description) lines.push(`description: "${yamlEscape(description)}"`);
  return `---\n${lines.join('\n')}\n---\n\n${content}`;
}
