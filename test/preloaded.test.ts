import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPipeline } from '../src/pipeline.js';

// mock LLM 避免真实调用
vi.mock('../src/transform/index.js', () => ({
  transformToSkill: vi
    .fn()
    .mockResolvedValue('# Mocked Skill Content for preload test.'),
}));

describe('preloaded 预加载内容（Web UI 文件上传）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('文件内容通过 preloaded 传入，不走 loader', async () => {
    const result = await runPipeline('__preloaded__', {
      agentType: 'codex',
      llm: { apiKey: 'test', model: 'mock-model' },
      dryRun: true,
      preloaded: {
        content:
          '# Test Document\n\nThis is test content for preloaded mechanism.',
        fileName: 'test.md',
      },
    });
    expect(result.content).toContain('Mocked Skill');
  });

  it('HTML 文件预加载时走 readability 提取', async () => {
    const para =
      '<p>This is body content long enough to pass density check. '.repeat(10) +
      '</p>';
    const htmlContent =
      '<!doctype html><html><head><title>Test Page</title></head>' +
      '<body><main><h1>Heading</h1>' +
      para +
      '</main></body></html>';
    const result = await runPipeline('__preloaded__', {
      agentType: 'codex',
      llm: { apiKey: 'test', model: 'mock-model' },
      dryRun: true,
      preloaded: {
        content: htmlContent,
        fileName: 'page.html',
      },
    });
    expect(result.content).toContain('Mocked Skill');
  });
  it('SPA 空壳 HTML 提取后内容过短会被拒绝（正确行为）', async () => {
    const spaHtml =
      '<!doctype html><html><head>' +
      '<script src="/assets/index-abc.js"></script></head>' +
      '<body><div id="root"></div></body></html>';
    // SPA 空壳提取后几乎无文字内容，pipeline 应抛出"内容过短"错误
    await expect(
      runPipeline('__preloaded__', {
        agentType: 'codex',
        llm: { apiKey: 'test', model: 'mock-model' },
        dryRun: true,
        preloaded: {
          content: spaHtml,
          fileName: 'spa-app.html',
        },
      }),
    ).rejects.toThrow('内容过短');
  });
});
