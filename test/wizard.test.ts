import { beforeEach, describe, expect, it, vi } from 'vitest';

const prompts = vi.hoisted(() => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));
const models = vi.hoisted(() => ({
  detectLocalModels: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => prompts);
vi.mock('../src/models.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/models.js')>(
      '../src/models.js',
    );
  return { ...actual, detectLocalModels: models.detectLocalModels };
});
vi.mock('../src/utils/logger.js', () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

import { runWizard } from '../src/wizard.js';

function validateInput(message: string, value: string): unknown {
  const config = prompts.input.mock.calls
    .map(
      (call) =>
        call[0] as { message: string; validate?: (v: string) => unknown },
    )
    .find((item) => item.message === message);
  expect(config?.validate).toEqual(expect.any(Function));
  return config!.validate!(value);
}

describe('runWizard 交互式向导', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.OPENAI_API_KEY;
    models.detectLocalModels.mockResolvedValue([]);
  });

  it('选择 UI 时解析端口，非法输入回退默认值', async () => {
    prompts.select.mockResolvedValue('ui');
    prompts.input.mockResolvedValue('not-a-port');
    await expect(runWizard()).resolves.toEqual({ mode: 'ui', port: 3456 });
  });

  it('取消主菜单返回 null', async () => {
    prompts.select.mockResolvedValue('other');
    await expect(runWizard()).resolves.toBeNull();
  });

  it('完成搜索向导的交互式模式', async () => {
    prompts.select
      .mockResolvedValueOnce('search')
      .mockResolvedValueOnce('interactive');
    prompts.input.mockResolvedValue('/tmp/project');
    await expect(runWizard()).resolves.toEqual({
      mode: 'search',
      projectRoot: '/tmp/project',
      interactive: true,
    });
  });

  it('完成搜索向导的单次模式并清理查询', async () => {
    prompts.select
      .mockResolvedValueOnce('search')
      .mockResolvedValueOnce('single');
    prompts.input
      .mockResolvedValueOnce(' /tmp/project ')
      .mockResolvedValueOnce('  auth flow  ');
    await expect(runWizard()).resolves.toMatchObject({
      mode: 'search',
      query: 'auth flow',
      interactive: false,
    });
  });

  it('完成环境迁移的导出、比对和导入分支', async () => {
    prompts.select.mockResolvedValueOnce('env');
    prompts.select.mockResolvedValueOnce('export');
    await expect(runWizard()).resolves.toEqual({
      mode: 'env',
      subAction: 'export',
    });

    vi.clearAllMocks();
    prompts.select.mockResolvedValueOnce('env');
    prompts.select.mockResolvedValueOnce('diff');
    prompts.input.mockResolvedValue(' snapshot.json ');
    await expect(runWizard()).resolves.toEqual({
      mode: 'env',
      subAction: 'diff',
      file: 'snapshot.json',
    });

    vi.clearAllMocks();
    prompts.select.mockResolvedValueOnce('env');
    prompts.select.mockResolvedValueOnce('import');
    prompts.input.mockResolvedValue('snapshot.json');
    prompts.confirm.mockResolvedValue(true);
    await expect(runWizard()).resolves.toEqual({
      mode: 'env',
      subAction: 'import',
      file: 'snapshot.json',
      execute: true,
    });
  });

  it('完成规则同步和单文件转换', async () => {
    prompts.select.mockResolvedValueOnce('convert');
    prompts.select.mockResolvedValueOnce('sync');
    prompts.input.mockResolvedValue('/tmp/project');
    prompts.confirm.mockResolvedValue(false);
    await expect(runWizard()).resolves.toEqual({
      mode: 'sync',
      projectRoot: '/tmp/project',
      dryRun: false,
    });

    vi.clearAllMocks();
    prompts.select
      .mockResolvedValueOnce('convert')
      .mockResolvedValueOnce('single')
      .mockResolvedValueOnce('claude');
    prompts.input.mockResolvedValue(' .cursor/rules/api.mdc ');
    await expect(runWizard()).resolves.toEqual({
      mode: 'convert',
      file: '.cursor/rules/api.mdc',
      to: 'claude',
    });
    expect(
      validateInput(
        '📄 输入要转换的规则文件路径 (如 .cursor/rules/api.mdc 或 SKILL.md)：',
        '',
      ),
    ).toBe('文件路径不能为空');
  });

  it('云端模型使用环境变量并支持自定义名称', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    prompts.select
      .mockResolvedValueOnce('skill')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('deepseek-chat');
    prompts.input
      .mockResolvedValueOnce(' a.md, b.md ')
      .mockResolvedValueOnce(' My Skill ')
      .mockResolvedValueOnce(' output.md ');
    prompts.confirm.mockResolvedValue(true);
    const result = await runWizard();
    expect(
      validateInput('📄 文档来源（URL 或本地文件路径，多个用逗号隔开）：', ''),
    ).toBe('不能为空');
    expect(result).toMatchObject({
      mode: 'skill',
      data: {
        sources: ['a.md', 'b.md'],
        agentType: 'codex',
        name: 'My Skill',
        outputPath: 'output.md',
        llm: { apiKey: 'test-key', model: 'deepseek-chat' },
      },
    });
  });

  it('云端模型无 key 时提示输入，确认取消返回 null', async () => {
    prompts.select
      .mockResolvedValueOnce('skill')
      .mockResolvedValueOnce('cursor')
      .mockResolvedValueOnce('gpt-4o');
    prompts.input
      .mockResolvedValueOnce('guide.md')
      .mockResolvedValueOnce('manual-key')
      .mockResolvedValueOnce('');
    prompts.confirm.mockResolvedValue(false);
    await expect(runWizard()).resolves.toBeNull();
    expect(
      validateInput('🔑 输入 API Key（或设置 OPENAI_API_KEY 后重试）：', ''),
    ).toBe('API Key 不能为空');
  });

  it('本地模型探测到模型并使用自定义地址', async () => {
    models.detectLocalModels.mockResolvedValue([
      { id: 'llama3', name: 'Llama 3' },
    ]);
    prompts.select
      .mockResolvedValueOnce('skill')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('ollama-local')
      .mockResolvedValueOnce('llama3');
    prompts.input
      .mockResolvedValueOnce('guide.md')
      .mockResolvedValueOnce('http://localhost:11434')
      .mockResolvedValueOnce('');
    prompts.confirm.mockResolvedValue(true);
    const result = await runWizard();
    expect(validateInput('🏠 输入本地模型服务地址：', 'localhost')).toBe(
      '请输入完整 URL',
    );
    await expect(Promise.resolve(result)).resolves.toMatchObject({
      mode: 'skill',
      data: {
        llm: {
          apiKey: 'local-no-key',
          model: 'llama3',
          baseURL: 'http://localhost:11434/v1',
        },
      },
    });
  });

  it('本地模型探测为空时手动输入模型', async () => {
    prompts.select
      .mockResolvedValueOnce('skill')
      .mockResolvedValueOnce('codex')
      .mockResolvedValueOnce('custom-local');
    prompts.input
      .mockResolvedValueOnce('guide.md')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('http://localhost:1234')
      .mockResolvedValueOnce('custom-model')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('');
    prompts.confirm.mockResolvedValue(true);
    const result = await runWizard();
    expect(prompts.input.mock.calls.map((call) => call[0].message)).toEqual([
      '📄 文档来源（URL 或本地文件路径，多个用逗号隔开）：',
      '🏷️  技能名（回车跳过，将从文档标题自动生成）：',
      '🏠 输入本地模型服务地址：',
      '🧠 输入本地模型名称：',
      '💾 自定义主文件路径（回车使用推荐结构）：',
    ]);
    expect(validateInput('🧠 输入本地模型名称：', '')).toBe('不能为空');
    await expect(Promise.resolve(result)).resolves.toMatchObject({
      mode: 'skill',
      data: { llm: { model: 'custom-model' } },
    });
  });
});
