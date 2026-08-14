/**
 * 规则解析器
 *
 * 识别并解析 Cursor (.mdc)、Codex (SKILL.md)、Claude (CLAUDE.md) 等规则格式。
 */
import { basename, extname } from 'node:path';
import type { ParsedRule, RuleFormat, RuleMetadata } from './types.js';

/** 根据路径与内容特征检测规则格式 */
export function detectRuleFormat(
  filePath?: string,
  content?: string,
): RuleFormat {
  if (filePath) {
    const norm = filePath.replaceAll('\\', '/').toLowerCase();
    if (norm.endsWith('.mdc') || norm.includes('.cursor/rules/'))
      return 'cursor';
    if (norm.includes('.agents/skills/') || norm.endsWith('skill.md'))
      return 'codex';
    if (norm.endsWith('claude.md') || norm.includes('.claude/rules/'))
      return 'claude';
  }

  if (content) {
    const trimmed = content.trim();
    if (/^---\r?\n[\s\S]*?globs:[\s\S]*?---/i.test(trimmed)) return 'cursor';
    if (/^---\r?\n[\s\S]*?name:[\s\S]*?---/i.test(trimmed)) return 'codex';
    if (/^#\s+CLAUDE\.md/i.test(trimmed) || /^#\s+Claude\s+Code/i.test(trimmed))
      return 'claude';
  }

  return 'generic';
}

/** 解析规则内容 */
export function parseRule(content: string, filePath?: string): ParsedRule {
  const format = detectRuleFormat(filePath, content);
  const rawContent = content;

  let meta: RuleMetadata = {};
  let body: string;

  // 1. 检查并提取 YAML Frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const yamlBlock = fmMatch[1];
    body = fmMatch[2].trim();
    meta = parseSimpleYaml(yamlBlock);
  } else {
    body = content.trim();
  }

  // 2. 提取标题
  const h1Match = body.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : undefined;

  // 3. 回退名称与描述
  if (!meta.name && filePath) {
    const base = basename(filePath, extname(filePath));
    if (base.toLowerCase() === 'skill') {
      // .agents/skills/<name>/SKILL.md -> 提取上级目录名
      const parts = filePath.replaceAll('\\', '/').split('/');
      const parent = parts[parts.length - 2];
      meta.name = parent || 'custom-skill';
    } else {
      meta.name = base;
    }
  }

  if (!meta.description && title) {
    meta.description = title;
  }

  return {
    format,
    meta,
    title,
    body,
    rawContent,
    sourcePath: filePath,
  };
}

/** 简单的轻量 YAML Frontmatter 解析器（支持字符串、布尔、数组） */
function parseSimpleYaml(yaml: string): RuleMetadata {
  const meta: RuleMetadata = {};
  const lines = yaml.split(/\r?\n/);

  let currentKey = '';
  let inArray = false;
  let arrayValues: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // 数组项
    if (inArray && trimmed.startsWith('-')) {
      const item = trimmed
        .slice(1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      if (item) arrayValues.push(item);
      continue;
    } else if (inArray && !trimmed.startsWith('-')) {
      if (currentKey === 'globs') meta.globs = arrayValues;
      inArray = false;
      arrayValues = [];
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();

    if (!rawVal) {
      // 可能是数组开始
      currentKey = key;
      inArray = true;
      arrayValues = [];
      continue;
    }

    const val = rawVal.replace(/^['"]|['"]$/g, '');

    if (key === 'name') {
      meta.name = val;
    } else if (key === 'description') {
      meta.description = val;
    } else if (key === 'globs') {
      if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
        meta.globs = rawVal
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      } else {
        meta.globs = [val];
      }
    } else if (key === 'alwaysApply') {
      meta.alwaysApply = val === 'true' || val === 'yes';
    }
  }

  if (inArray && currentKey === 'globs') {
    meta.globs = arrayValues;
  }

  return meta;
}
