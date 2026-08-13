/**
 * 配置文件加载器测试
 */
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('loadConfig', () => {
  it('无配置文件时返回空对象', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-nocfg-'));
    const config = await loadConfig(dir);
    expect(config).toEqual({});
  });

  it('读取 .doc2skill.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-cfg-'));
    await writeFile(
      join(dir, '.doc2skill.json'),
      JSON.stringify({ type: 'cursor', model: 'gpt-4o' }),
    );
    const config = await loadConfig(dir);
    expect(config.type).toBe('cursor');
    expect(config.model).toBe('gpt-4o');
  });

  it('忽略不认识的字段', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-unknown-'));
    await writeFile(
      join(dir, '.doc2skill.json'),
      JSON.stringify({ type: 'claude', unknownField: 'xxx', verbose: true }),
    );
    const config = await loadConfig(dir);
    expect(config.type).toBe('claude');
    expect(config.verbose).toBe(true);
    expect((config as any).unknownField).toBeUndefined();
  });

  it('无效 type 抛错', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-badtype-'));
    await writeFile(
      join(dir, '.doc2skill.json'),
      JSON.stringify({ type: 'invalid' }),
    );
    await expect(loadConfig(dir)).rejects.toThrow('type 无效');
  });

  it('顶层不是对象时抛出明确错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-badshape-'));
    await writeFile(join(dir, '.doc2skill.json'), 'null');
    await expect(loadConfig(dir)).rejects.toThrow('顶层必须是 JSON 对象');
  });

  it('字段类型错误时拒绝配置', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-badfield-'));
    await writeFile(
      join(dir, '.doc2skill.json'),
      JSON.stringify({ verbose: 'yes' }),
    );
    await expect(loadConfig(dir)).rejects.toThrow('verbose 必须是布尔值');
  });

  it('支持 .doc2skillrc 格式', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-rc-'));
    await writeFile(
      join(dir, '.doc2skillrc'),
      JSON.stringify({ model: 'gpt-4o-mini', out: './rules.md' }),
    );
    const config = await loadConfig(dir);
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.out).toBe('./rules.md');
  });

  it('读取并校验 outputMode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-mode-'));
    await writeFile(
      join(dir, '.doc2skill.json'),
      JSON.stringify({ outputMode: 'legacy' }),
    );
    expect((await loadConfig(dir)).outputMode).toBe('legacy');

    const badDir = await mkdtemp(join(tmpdir(), 'doc2skill-badmode-'));
    await writeFile(
      join(badDir, '.doc2skill.json'),
      JSON.stringify({ outputMode: 'future' }),
    );
    await expect(loadConfig(badDir)).rejects.toThrow('outputMode 无效');
  });

  it('子目录查找会递归到父目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'doc2skill-parent-'));
    await writeFile(
      join(root, '.doc2skill.json'),
      JSON.stringify({ type: 'codex' }),
    );
    const subdir = join(root, 'sub', 'dir');
    await mkdir(subdir, { recursive: true });
    const config = await loadConfig(subdir);
    expect(config.type).toBe('codex');
  });
});
