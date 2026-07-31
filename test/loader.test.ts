/**
 * Loader 单元测试 — 验证文档加载管线（不依赖 LLM）
 */
import { describe, it, expect } from 'vitest';
import { detectSourceType, loadFromHtml } from '../src/loader/index.js';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatResult,
  isValidAgentType,
  DEFAULT_OUTPUT_PATHS,
} from '../src/format/index.js';

describe('detectSourceType', () => {
  it('识别 URL', () => {
    expect(detectSourceType('https://docs.example.com/api')).toBe('url');
    expect(detectSourceType('http://localhost:3000')).toBe('url');
  });

  it('识别 PDF', () => {
    expect(detectSourceType('./guide.pdf')).toBe('pdf');
  });

  it('识别 HTML', () => {
    expect(detectSourceType('./page.html')).toBe('html');
    expect(detectSourceType('./page.htm')).toBe('html');
  });

  it('识别 Markdown', () => {
    expect(detectSourceType('README.md')).toBe('markdown');
    expect(detectSourceType('guide.markdown')).toBe('markdown');
  });

  it('识别文本', () => {
    expect(detectSourceType('config.yaml')).toBe('text');
    expect(detectSourceType('data.json')).toBe('text');
  });

  it('未知后缀默认文本', () => {
    expect(detectSourceType('notes')).toBe('text');
  });
});

describe('isValidAgentType', () => {
  it('接受合法类型', () => {
    expect(isValidAgentType('codex')).toBe(true);
    expect(isValidAgentType('cursor')).toBe(true);
    expect(isValidAgentType('claude')).toBe(true);
  });

  it('拒绝非法类型', () => {
    expect(isValidAgentType('github')).toBe(false);
    expect(isValidAgentType('')).toBe(false);
  });
});

describe('formatResult', () => {
  it('生成正确的默认路径', () => {
    const codex = formatResult('# Test', 'codex');
    expect(codex.suggestedPath).toBe('./SKILL.md');
    expect(codex.content).toBe('# Test\n');

    const cursor = formatResult('rules', 'cursor');
    expect(cursor.suggestedPath).toBe('./.cursorrules');

    const claude = formatResult('memory', 'claude');
    expect(claude.suggestedPath).toBe('./CLAUDE.md');
  });

  it('使用自定义路径', () => {
    const r = formatResult('# Hi', 'codex', './out/custom.md');
    expect(r.suggestedPath).toBe('./out/custom.md');
  });

  it('确保单换行结尾', () => {
    const r = formatResult('# Hi\n\n\n\n', 'codex');
    expect(r.content).toBe('# Hi\n');
  });
});

describe('DEFAULT_OUTPUT_PATHS', () => {
  it('包含全部三种 Agent', () => {
    const keys = Object.keys(DEFAULT_OUTPUT_PATHS);
    expect(keys).toContain('codex');
    expect(keys).toContain('cursor');
    expect(keys).toContain('claude');
  });
});

describe('loadFromHtml', () => {
  it('从本地 HTML 文件提取正文为 Markdown', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-html-'));
    const htmlPath = join(dir, 'test.html');
    await writeFile(
      htmlPath,
      '<html><head><title>Test Page</title></head>' +
        '<body><nav>Home About</nav><main><h1>Hello World</h1>' +
        '<p>This is a paragraph with enough text to pass content checks.</p>' +
        '<p>Another paragraph here.</p></main></body></html>',
    );

    const doc = await loadFromHtml(htmlPath);
    expect(doc.type).toBe('html');
    expect(doc.title).toBe('Test Page');
    expect(doc.content).toContain('Hello World');
    expect(doc.content).toContain('paragraph');
    // 导航文字应被清洗掉
    expect(doc.content).not.toContain('About');
  });
});
