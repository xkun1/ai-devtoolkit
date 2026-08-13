/**
 * 增量更新 hash 测试
 */
import { describe, it, expect } from 'vitest';
import {
  buildGenerationFingerprint,
  createCacheKey,
  contentHash,
  getCachePath,
  loadCachedResult,
  needsUpdate,
  markGenerated,
  saveGeneratedResult,
} from '../src/utils/hash.js';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('contentHash', () => {
  it('相同内容返回相同 hash', () => {
    expect(contentHash('hello')).toBe(contentHash('hello'));
  });

  it('不同内容返回不同 hash', () => {
    expect(contentHash('hello')).not.toBe(contentHash('world'));
  });

  it('使用完整 SHA-256（64 个十六进制字符）', () => {
    expect(contentHash('test')).toMatch(/^[a-f0-9]{64}$/);
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

describe('P1 增量缓存', () => {
  it('模型、温度、名称或输出模式变化会改变指纹', () => {
    const base = {
      source: 'doc.md',
      content: 'content',
      agentType: 'codex' as const,
      model: 'model-a',
      temperature: 0.3,
      name: 'skill-a',
      outputMode: 'modern' as const,
      promptVersion: 'v1',
    };
    const fingerprint = buildGenerationFingerprint(base);
    expect(buildGenerationFingerprint({ ...base, model: 'model-b' })).not.toBe(
      fingerprint,
    );
    expect(buildGenerationFingerprint({ ...base, temperature: 0.4 })).not.toBe(
      fingerprint,
    );
    expect(buildGenerationFingerprint({ ...base, name: 'skill-b' })).not.toBe(
      fingerprint,
    );
    expect(
      buildGenerationFingerprint({ ...base, outputMode: 'legacy' }),
    ).not.toBe(fingerprint);
  });

  it('命中时返回磁盘真实产物，产物被改动后缓存失效', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hash-artifact-'));
    const out = join(dir, 'SKILL.md');
    const cachePath = getCachePath(out);
    const key = createCacheKey('doc.md', out);
    const fingerprint = buildGenerationFingerprint({
      source: 'doc.md',
      content: 'source content',
      agentType: 'codex',
      model: 'mock',
    });
    const generated = '---\nname: test\ndescription: "test"\n---\n\n# Skill\n';
    writeFileSync(out, generated);
    saveGeneratedResult(cachePath, key, fingerprint, {
      agentType: 'codex',
      content: generated,
      suggestedPath: out,
      artifacts: [{ path: out, content: generated, kind: 'primary' }],
    });

    const hit = loadCachedResult(cachePath, key, fingerprint, 'codex');
    expect(hit?.content).toBe(readFileSync(out, 'utf-8'));
    writeFileSync(out, `${generated}\nmanual change`);
    expect(
      loadCachedResult(cachePath, key, fingerprint, 'codex'),
    ).toBeUndefined();
  });
});
