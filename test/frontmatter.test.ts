import { describe, it, expect } from 'vitest';
import {
  slugify,
  extractDescription,
  hasFrontmatter,
  injectSkillFrontmatter,
} from '../src/format/frontmatter.js';

describe('slugify', () => {
  it('基本转换：小写 + 连字符', () => {
    expect(slugify('React Hooks Guide')).toBe('react-hooks-guide');
  });

  it('去除特殊字符并压缩连字符', () => {
    expect(slugify('  Vue.js — 官方文档 (v3)!! ')).toBe('vue-js-v3');
  });

  it('纯中文标题回退到默认值', () => {
    expect(slugify('完全中文标题')).toBe('doc-skill');
  });

  it('超长标题截断到 64 字符', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(64);
  });

  it('空字符串回退到默认值', () => {
    expect(slugify('')).toBe('doc-skill');
  });
});

describe('extractDescription', () => {
  it('优先提取第一个 # 标题', () => {
    const content = '# My Awesome Skill\n\nSome content here';
    expect(extractDescription(content, 'fallback')).toBe('My Awesome Skill');
  });

  it('无标题时取首个非空行', () => {
    const content = '\n\nJust a plain line of text\nmore';
    expect(extractDescription(content, 'fallback')).toBe(
      'Just a plain line of text',
    );
  });

  it('清理 markdown 标记符号', () => {
    const content = '# **Bold** `Code` [Link]';
    expect(extractDescription(content, 'fallback')).toBe('Bold Code Link');
  });

  it('空内容回退到 fallback', () => {
    expect(extractDescription('', 'my fallback')).toBe('my fallback');
  });
});

describe('hasFrontmatter', () => {
  it('识别已有 frontmatter', () => {
    const content = '---\nname: test\n---\n\n# Content';
    expect(hasFrontmatter(content)).toBe(true);
  });

  it('无 frontmatter 返回 false', () => {
    expect(hasFrontmatter('# Just Content')).toBe(false);
  });

  it('正文中间的 --- 不算 frontmatter', () => {
    const content = '# Title\n\nSome text\n\n---\n\nMore text';
    expect(hasFrontmatter(content)).toBe(false);
  });
});

describe('injectSkillFrontmatter', () => {
  it('注入 name + description', () => {
    const result = injectSkillFrontmatter('# Test Skill\n\nContent', {
      name: 'my-skill',
    });
    expect(result).toMatch(
      /^---\nname: my-skill\ndescription: "Test Skill"\n---\n\n/,
    );
  });

  it('未指定 name 时从标题 slugify', () => {
    const result = injectSkillFrontmatter('# React Guide\n\nContent', {
      title: 'React Guide',
    });
    expect(result).toContain('name: react-guide');
  });

  it('已有 frontmatter 时保留原样', () => {
    const content = '---\nname: existing\n---\n\n# Content';
    expect(injectSkillFrontmatter(content, { name: 'other' })).toBe(content);
  });

  it('description 优先使用 meta 提供值', () => {
    const result = injectSkillFrontmatter('# Title\n\nBody', {
      name: 'x',
      description: 'Custom desc',
    });
    expect(result).toContain('description: "Custom desc"');
  });

  it('description 中的双引号被转义', () => {
    const result = injectSkillFrontmatter('# Title\n\nBody', {
      name: 'x',
      description: 'Say "hello"',
    });
    expect(result).toContain('description: "Say \\"hello\\""');
  });
});
