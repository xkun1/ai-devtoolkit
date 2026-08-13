import { describe, expect, it, vi } from 'vitest';
import { createProgram } from '../src/cli.js';

async function parse(args: string[]): Promise<void> {
  const program = createProgram();
  program.exitOverride();
  program.configureOutput({
    writeOut: vi.fn(),
    writeErr: vi.fn(),
  });
  await program.parseAsync(['node', 'doc2skill', ...args]);
}

describe('CLI 参数契约', () => {
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
});
