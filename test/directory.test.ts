import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  scanDirectory,
  isSupportedFile,
  expandSources,
  isDirectory,
} from '../src/loader/directory.js';

const TMP = join(tmpdir(), `doc2skill-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('isSupportedFile', () => {
  it('支持 .md/.pdf/.docx/.html/.txt 等格式', () => {
    expect(isSupportedFile('readme.md')).toBe(true);
    expect(isSupportedFile('doc.pdf')).toBe(true);
    expect(isSupportedFile('spec.docx')).toBe(true);
    expect(isSupportedFile('page.html')).toBe(true);
    expect(isSupportedFile('notes.txt')).toBe(true);
    expect(isSupportedFile('data.json')).toBe(true);
    expect(isSupportedFile('config.yaml')).toBe(true);
  });

  it('不支持非文档格式', () => {
    expect(isSupportedFile('app.exe')).toBe(false);
    expect(isSupportedFile('image.png')).toBe(false);
    expect(isSupportedFile('binary.bin')).toBe(false);
  });
});

describe('scanDirectory', () => {
  it('递归扫描所有受支持的文件', async () => {
    await writeFile(join(TMP, 'a.md'), '# A');
    await writeFile(join(TMP, 'b.txt'), 'B');
    await mkdir(join(TMP, 'sub'));
    await writeFile(join(TMP, 'sub', 'c.json'), '{}');
    await writeFile(join(TMP, 'sub', 'd.pdf'), 'fake-pdf');

    const files = await scanDirectory(TMP);
    expect(files.length).toBe(4);
    expect(files.some((f) => f.endsWith('a.md'))).toBe(true);
    expect(files.some((f) => f.endsWith('c.json'))).toBe(true);
  });

  it('忽略 node_modules/.git/dist 等目录', async () => {
    await mkdir(join(TMP, 'node_modules'), { recursive: true });
    await mkdir(join(TMP, '.git'), { recursive: true });
    await writeFile(join(TMP, 'node_modules', 'lib.md'), 'lib');
    await writeFile(join(TMP, '.git', 'config.md'), 'cfg');
    await writeFile(join(TMP, 'real.md'), '# Real');

    const files = await scanDirectory(TMP);
    expect(files.length).toBe(1);
    expect(files[0].endsWith('real.md')).toBe(true);
  });

  it('忽略隐藏文件', async () => {
    await writeFile(join(TMP, '.hidden.md'), 'hidden');
    await writeFile(join(TMP, 'visible.md'), 'visible');

    const files = await scanDirectory(TMP);
    expect(files.length).toBe(1);
    expect(files[0].endsWith('visible.md')).toBe(true);
  });

  it('尊重 maxDepth 限制', async () => {
    await mkdir(join(TMP, 'l1', 'l2', 'l3'), { recursive: true });
    await writeFile(join(TMP, 'l1', 'shallow.md'), 's');
    await writeFile(join(TMP, 'l1', 'l2', 'l3', 'deep.md'), 'd');

    const filesDepth1 = await scanDirectory(TMP, { maxDepth: 1 });
    expect(filesDepth1.some((f) => f.endsWith('shallow.md'))).toBe(true);
    expect(filesDepth1.some((f) => f.endsWith('deep.md'))).toBe(false);
  });
});

describe('expandSources', () => {
  it('展开目录为文件列表，普通路径原样保留', async () => {
    await writeFile(join(TMP, 'doc1.md'), '# D1');
    await writeFile(join(TMP, 'doc2.md'), '# D2');

    const { files, hadDirectory } = await expandSources([TMP, '/some/file.md']);
    expect(hadDirectory).toBe(true);
    expect(files.length).toBe(3); // 2 from dir + 1 plain path
  });

  it('纯文件列表 hadDirectory=false', async () => {
    const { hadDirectory } = await expandSources(['/path/a.md', '/path/b.md']);
    expect(hadDirectory).toBe(false);
  });
});

describe('isDirectory', () => {
  it('正确识别目录和文件', async () => {
    await writeFile(join(TMP, 'file.md'), 'content');
    expect(await isDirectory(TMP)).toBe(true);
    expect(await isDirectory(join(TMP, 'file.md'))).toBe(false);
    expect(await isDirectory('/nonexistent/path')).toBe(false);
  });
});
