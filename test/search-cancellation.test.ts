import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

const mockExplainResults = vi.hoisted(() => vi.fn());
vi.mock('../src/search/explainer.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/search/explainer.js')>()),
  explainResults: mockExplainResults,
}));

import { searchAndPrint } from '../src/search/index.js';
import { startInteractiveSearch } from '../src/search/interactive.js';
import type { SearchIndex } from '../src/search/types.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  mockExplainResults.mockReset();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('代码搜索取消传播', () => {
  it('LLM 解释取消时不降级吞掉错误', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'devtoolkit-search-abort-'));
    temporaryDirectories.push(directory);
    await writeFile(
      join(directory, 'auth.ts'),
      'export function authenticateUser() { return true; }\n',
    );
    const abortError = Object.assign(new Error('用户取消搜索'), {
      name: 'AbortError',
    });
    mockExplainResults.mockRejectedValue(abortError);

    await expect(
      searchAndPrint(
        'authenticateUser',
        { apiKey: 'test', model: 'test-model' },
        true,
        directory,
      ),
    ).rejects.toBe(abortError);
  });

  it('交互会话退出时正常结束 Promise，不强制退出宿主进程', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const index: SearchIndex = {
      version: 'test',
      projectRoot: process.cwd(),
      createdAt: Date.now(),
      files: [],
      chunks: [],
      symbols: [],
      invertedIndex: {},
      symbolIndex: {},
      stats: {
        totalFiles: 0,
        totalLines: 0,
        totalChunks: 0,
        totalSymbols: 0,
        totalKeywords: 0,
        languages: {},
      },
    };

    const session = startInteractiveSearch({
      index,
      useExplain: false,
      input,
      output,
    });
    input.end(':q\n');
    await expect(session).resolves.toBeUndefined();
  });
});
