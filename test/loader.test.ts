/**
 * Loader 单元测试 — 验证文档加载管线（不依赖 LLM）
 */
import { describe, it, expect } from 'vitest';
import { detectSourceType } from '../src/loader/index.js';
import { loadFromFile } from '../src/loader/file.js';
import { formatResult, isValidAgentType, DEFAULT_OUTPUT_PATHS } from '../src/format/index.js';
import type { AgentType } from '../src/types/index.js';

describe('detectSourceType', () => {
  it('识别 URL', () => {
    expect(detectSourceType('https://docs.example.com/api')).toBe('url');
    expect(detectSourceType('http://localhost:3000')).toBe('url');
  });

  it('识别 PDF', () => {
    expect(detectSourceType('./guide.pdf')).toBe('pdf');
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
