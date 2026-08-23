import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFilesAtomic } from '../src/utils/atomic-write.js';

describe('批量原子写入', () => {
  it('一次提交多个文本文件并拒绝重复目标', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devtoolkit-atomic-'));
    const first = join(root, 'first.md');
    const second = join(root, 'nested', 'second.md');

    await writeFilesAtomic([
      { path: first, content: 'first' },
      { path: second, content: 'second' },
    ]);
    expect(await readFile(first, 'utf-8')).toBe('first');
    expect(await readFile(second, 'utf-8')).toBe('second');

    await expect(
      writeFilesAtomic([
        { path: first, content: 'one' },
        { path: join(root, '.', 'first.md'), content: 'two' },
      ]),
    ).rejects.toThrow('重复路径');
  });

  it('预检发现目录目标时不会改动其他文件', async () => {
    const root = await mkdtemp(join(tmpdir(), 'devtoolkit-atomic-'));
    const first = join(root, 'first.md');
    const directory = join(root, 'target-dir');
    await writeFile(first, 'original');
    await mkdir(directory);

    await expect(
      writeFilesAtomic([
        { path: first, content: 'changed' },
        { path: directory, content: 'invalid' },
      ]),
    ).rejects.toThrow('不是普通文件');
    expect(await readFile(first, 'utf-8')).toBe('original');
  });

  it.skipIf(process.platform === 'win32')(
    '后续写入失败时恢复已覆盖文件并删除已新建文件',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'devtoolkit-atomic-'));
      const existing = join(root, 'existing.md');
      const created = join(root, 'created.md');
      const lockedDir = join(root, 'locked');
      await writeFile(existing, 'original');
      await mkdir(lockedDir);
      await chmod(lockedDir, 0o500);

      try {
        await expect(
          writeFilesAtomic([
            { path: existing, content: 'changed' },
            { path: created, content: 'temporary' },
            { path: join(lockedDir, 'blocked.md'), content: 'blocked' },
          ]),
        ).rejects.toBeDefined();
        expect(await readFile(existing, 'utf-8')).toBe('original');
        expect(existsSync(created)).toBe(false);
      } finally {
        await chmod(lockedDir, 0o700);
      }
    },
  );
});
