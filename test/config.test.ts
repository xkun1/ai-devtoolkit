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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-nocfg-'));
    const config = await loadConfig(dir);
    expect(config).toEqual({});
  });

  it('读取 .devtoolkit.json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-cfg-'));
    await writeFile(
      join(dir, '.devtoolkit.json'),
      JSON.stringify({ type: 'cursor', model: 'gpt-4o' }),
    );
    const config = await loadConfig(dir);
    expect(config.type).toBe('cursor');
    expect(config.model).toBe('gpt-4o');
  });

  it('忽略不认识的字段', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-unknown-'));
    await writeFile(
      join(dir, '.devtoolkit.json'),
      JSON.stringify({ type: 'claude', unknownField: 'xxx', verbose: true }),
    );
    const config = await loadConfig(dir);
    expect(config.type).toBe('claude');
    expect(config.verbose).toBe(true);
    expect((config as any).unknownField).toBeUndefined();
  });

  it('无效 type 抛错', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-badtype-'));
    await writeFile(
      join(dir, '.devtoolkit.json'),
      JSON.stringify({ type: 'invalid' }),
    );
    await expect(loadConfig(dir)).rejects.toThrow('type 无效');
  });

  it('顶层不是对象时抛出明确错误', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-badshape-'));
    await writeFile(join(dir, '.devtoolkit.json'), 'null');
    await expect(loadConfig(dir)).rejects.toThrow('顶层必须是 JSON 对象');
  });

  it('字段类型错误时拒绝配置', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-badfield-'));
    await writeFile(
      join(dir, '.devtoolkit.json'),
      JSON.stringify({ verbose: 'yes' }),
    );
    await expect(loadConfig(dir)).rejects.toThrow('verbose 必须是布尔值');
  });

  it('支持 .devtoolkitrc 格式', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-rc-'));
    await writeFile(
      join(dir, '.devtoolkitrc'),
      JSON.stringify({ model: 'gpt-4o-mini', out: './rules.md' }),
    );
    const config = await loadConfig(dir);
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.out).toBe('./rules.md');
  });

  it('读取并校验 outputMode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-mode-'));
    await writeFile(
      join(dir, '.devtoolkit.json'),
      JSON.stringify({ outputMode: 'legacy' }),
    );
    expect((await loadConfig(dir)).outputMode).toBe('legacy');

    const badDir = await mkdtemp(join(tmpdir(), 'devtoolkit-badmode-'));
    await writeFile(
      join(badDir, '.devtoolkit.json'),
      JSON.stringify({ outputMode: 'future' }),
    );
    await expect(loadConfig(badDir)).rejects.toThrow('outputMode 无效');
  });

  it('子目录查找会递归到父目录', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devtoolkit-parent-'));
    await writeFile(
      join(root, '.devtoolkit.json'),
      JSON.stringify({ type: 'codex' }),
    );
    const subdir = join(root, 'sub', 'dir');
    await mkdir(subdir, { recursive: true });
    const config = await loadConfig(subdir);
    expect(config.type).toBe('codex');
  });
});
