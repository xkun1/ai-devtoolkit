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

  it('注册 --watch、--local-model 与 --legacy', () => {
    const help = createProgram().helpInformation();
    expect(help).toContain('--watch');
    expect(help).toContain('--local-model');
    expect(help).toContain('--legacy');
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

  it('配置文件默认值会传入 Pipeline，CLI 参数保持最高优先级', async () => {
    mocks.loadConfig.mockResolvedValue({
      out: 'config-output',
      name: 'config-name',
      template: 'api-doc',
      outputMode: 'legacy',
      type: 'cursor',
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
    );
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
