import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runPipeline: vi.fn(),
  loadConfig: vi.fn(),
  searchAndPrint: vi.fn(),
  initCodeIndex: vi.fn(),
  startSearchSession: vi.fn(),
}));

vi.mock('../src/pipeline.js', () => ({ runPipeline: mocks.runPipeline }));
vi.mock('../src/config.js', () => ({ loadConfig: mocks.loadConfig }));
vi.mock('../src/search/index.js', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  searchAndPrint: mocks.searchAndPrint,
  initCodeIndex: mocks.initCodeIndex,
  startSearchSession: mocks.startSearchSession,
}));

import { createProgram } from '../src/cli.js';
import { AGENT_TYPES } from '../src/agents.js';

async function parse(args: string[]): Promise<void> {
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: vi.fn(),
    writeErr: vi.fn(),
  });
  await program.parseAsync(['node', 'devtoolkit', ...args]);
}

describe('CLI 参数契约', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue({});
  });

  it('注册长任务资源控制参数', () => {
    const help = createProgram().helpInformation();
    expect(help).toContain('--watch');
    expect(help).toContain('--local-model');
    expect(help).toContain('--legacy');
    expect(help).toContain('--llm-timeout');
    expect(help).toContain('--max-output-tokens');
    expect(help).toContain('--batch-concurrency');
    expect(help).toContain('--eval-max-cases');
    expect(help).toContain('--search-mode');
    expect(help).toContain('--sensitive-policy');
    for (const agent of AGENT_TYPES) expect(help).toContain(agent);
  });

  it('拒绝非法端口', async () => {
    await expect(parse(['--ui', '--port', 'nope'])).rejects.toThrow(
      'port 必须是整数',
    );
    await expect(parse(['--ui', '--port', '70000'])).rejects.toThrow(
      'port 必须在 1-65535 之间',
    );
  });

  it('拒绝非法爬取参数', async () => {
    await expect(parse(['--crawl-depth', '11'])).rejects.toThrow(
      'crawl-depth 必须在 0-10 之间',
    );
    await expect(parse(['--crawl-pages', '0'])).rejects.toThrow(
      'crawl-pages 必须在 1-500 之间',
    );
  });

  it('未知模板直接报错', async () => {
    await expect(
      parse([
        'examples/sample-doc.md',
        '--template',
        'missing',
        '--api-key',
        'test',
      ]),
    ).rejects.toThrow('未知模板');
  });

  it('custom-local 必须同时提供模型名和地址', async () => {
    await expect(
      parse(['examples/sample-doc.md', '--model', 'custom-local']),
    ).rejects.toThrow('缺少本地模型名');
    await expect(
      parse([
        'examples/sample-doc.md',
        '--model',
        'custom-local',
        '--local-model',
        'qwen3',
      ]),
    ).rejects.toThrow('必须通过 --base-url');
  });

  it('正确映射爬取与目录合并参数到 Pipeline', async () => {
    await parse([
      'examples/sample-doc.md',
      '--api-key',
      'test',
      '--crawl',
      '--crawl-depth',
      '3',
      '--crawl-pages',
      '42',
      '--merge',
      '--dir-depth',
      '7',
    ]);

    expect(mocks.runPipeline).toHaveBeenCalledWith(
      ['examples/sample-doc.md'],
      expect.objectContaining({
        crawl: true,
        crawlDepth: 3,
        crawlPages: 42,
        mergeDir: true,
        dirMaxDepth: 7,
      }),
    );
  });

  it('正确映射超时、Token 与批处理上限', async () => {
    await parse([
      'examples/sample-doc.md',
      '--api-key',
      'test',
      '--llm-timeout',
      '45000',
      '--max-output-tokens',
      '4096',
      '--batch-concurrency',
      '4',
      '--max-batch-files',
      '30',
    ]);

    expect(mocks.runPipeline).toHaveBeenCalledWith(
      ['examples/sample-doc.md'],
      expect.objectContaining({
        llm: expect.objectContaining({ maxOutputTokens: 4096 }),
        llmTimeoutMs: 45000,
        batchConcurrency: 4,
        maxBatchFiles: 30,
      }),
    );
  });

  it('正确校验并映射语言与敏感信息策略', async () => {
    await parse([
      'examples/sample-doc.md',
      '--api-key',
      'test',
      '--lang',
      'zh',
      '--sensitive-policy',
      'error',
    ]);
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      ['examples/sample-doc.md'],
      expect.objectContaining({ lang: 'zh', sensitivePolicy: 'error' }),
    );

    await expect(parse(['--lang', 'fr'])).rejects.toThrow('lang 必须是');
    await expect(parse(['--sensitive-policy', 'unknown'])).rejects.toThrow(
      'sensitive-policy 必须是',
    );
  });

  it.each(AGENT_TYPES)('CLI 接受 Agent 类型 %s', async (agentType) => {
    await parse([
      'examples/sample-doc.md',
      '--api-key',
      'test',
      '--type',
      agentType,
    ]);
    expect(mocks.runPipeline).toHaveBeenCalledWith(
      ['examples/sample-doc.md'],
      expect.objectContaining({ agentType }),
    );
  });

  it('配置文件默认值会传入 Pipeline，CLI 参数保持最高优先级', async () => {
    mocks.loadConfig.mockResolvedValue({
      out: 'config-output',
      name: 'config-name',
      template: 'api-doc',
      outputMode: 'legacy',
      type: 'cursor',
      llmTimeoutMs: 30000,
      maxOutputTokens: 2048,
      batchConcurrency: 3,
      maxBatchFiles: 40,
    });

    await parse([
      'examples/sample-doc.md',
      '--api-key',
      'test',
      '--out',
      'cli-output',
      '--name',
      'cli-name',
    ]);

    expect(mocks.runPipeline).toHaveBeenCalledWith(
      ['examples/sample-doc.md'],
      expect.objectContaining({
        agentType: 'cursor',
        outputPath: 'cli-output',
        name: 'cli-name',
        template: 'api-doc',
        outputMode: 'legacy',
        llm: expect.objectContaining({ maxOutputTokens: 2048 }),
        llmTimeoutMs: 30000,
        batchConcurrency: 3,
        maxBatchFiles: 40,
      }),
    );
  });

  it('--no-explain 会关闭代码搜索 LLM 解释', async () => {
    await parse([
      '.',
      '--search',
      'createProgram',
      '--api-key',
      'test',
      '--no-explain',
    ]);

    expect(mocks.searchAndPrint).toHaveBeenCalledWith(
      'createProgram',
      expect.any(Object),
      false,
      expect.any(String),
      { mode: 'hybrid' },
      expect.objectContaining({ signal: undefined }),
    );
  });

  it('--search-mode 传递检索模式并拒绝非法值', async () => {
    await parse([
      '.',
      '--search',
      'createProgram',
      '--search-mode',
      'exact',
      '--no-explain',
    ]);
    expect(mocks.searchAndPrint).toHaveBeenCalledWith(
      'createProgram',
      undefined,
      false,
      expect.any(String),
      { mode: 'exact' },
      expect.any(Object),
    );
    await expect(
      parse(['--search', 'x', '--search-mode', 'fuzzy']),
    ).rejects.toThrow('search-mode 必须是');
  });

  it('拒绝非法同步 Agent', async () => {
    await expect(parse(['--sync', '--sync-from', 'invalid'])).rejects.toThrow(
      '同步源 Agent',
    );
    await expect(
      parse(['--sync', '--sync-to', 'cursor,invalid']),
    ).rejects.toThrow('同步目标 Agent');
  });
});
