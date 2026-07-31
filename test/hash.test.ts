/**
 * 增量更新 hash 测试
 */
import { describe, it, expect } from 'vitest';
import {
  contentHash,
  getCachePath,
  needsUpdate,
  markGenerated,
} from '../src/utils/hash.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('contentHash', () => {
  it('相同内容返回相同 hash', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
  });

  it('不同内容返回不同 hash', () => {
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });

  it('hash 长度为 16', () => {
    expect(contentHash('test').length).toBe(16);
  });
});

describe('getCachePath', () => {
  it('缓存文件在输出目录', () => {
    const path = getCachePath('./output/SKILL.md');
    expect(path).toContain('.doc2skill-cache.json');
    expect(path).toContain('output');
  });
});

describe('needsUpdate / markGenerated', () => {
  it('首次运行需要更新', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hash-test-'));
    const cachePath = getCachePath(join(dir, 'SKILL.md'));
    expect(needsUpdate(cachePath, 'doc.md', 'content', 'codex')).toBe(true);
  });

  it('记录后不再需要更新', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hash-saved-'));
    const cachePath = getCachePath(join(dir, 'SKILL.md'));
    expect(needsUpdate(cachePath, 'doc.md', 'content', 'codex')).toBe(true);
    markGenerated(cachePath, 'doc.md', 'content', 'codex');
    expect(needsUpdate(cachePath, 'doc.md', 'content', 'codex')).toBe(false);
  });

  it('内容变更后需要更新', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hash-changed-'));
    const cachePath = getCachePath(join(dir, 'SKILL.md'));
    markGenerated(cachePath, 'doc.md', 'old content', 'codex');
    expect(needsUpdate(cachePath, 'doc.md', 'new content', 'codex')).toBe(true);
  });

  it('Agent 类型变更后需要更新', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hash-agent-'));
    const cachePath = getCachePath(join(dir, 'SKILL.md'));
    markGenerated(cachePath, 'doc.md', 'content', 'codex');
    expect(needsUpdate(cachePath, 'doc.md', 'content', 'cursor')).toBe(true);
  });
});
