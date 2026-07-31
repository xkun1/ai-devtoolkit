import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runPipeline } from '../src/pipeline.js';

// mock LLM 避免真实调用
vi.mock('../src/transform/index.js', () => ({
  transformToSkill: vi
    .fn()
    .mockResolvedValue('# Mocked Skill from binary upload.'),
}));

describe('二进制文件上传（PDF/DOCX Base64）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('文本类文件正常通过 preloaded content 传入', async () => {
    const result = await runPipeline('__preloaded__', {
      agentType: 'codex',
      llm: { apiKey: 'test', model: 'mock-model' },
      dryRun: true,
      preloaded: {
        content: '# Markdown Doc\n\nThis is sufficient content for testing.',
        fileName: 'readme.md',
      },
    });
    expect(result.content).toContain('Mocked Skill');
  });

  it('无效 Base64 PDF 抛出有意义的错误', async () => {
    await expect(
      runPipeline('__preloaded__', {
        agentType: 'codex',
        llm: { apiKey: 'test', model: 'mock-model' },
        dryRun: true,
        preloaded: {
          content: '',
          binaryContent: 'invalid-base64-data!!!',
          mimeType: 'application/pdf',
          fileName: 'broken.pdf',
        },
      }),
    ).rejects.toThrow('PDF');
  });

  it('未知二进制类型当文本读取', async () => {
    const result = await runPipeline('__preloaded__', {
      agentType: 'codex',
      llm: { apiKey: 'test', model: 'mock-model' },
      dryRun: true,
      preloaded: {
        content: '',
        binaryContent: Buffer.from(
          '# Plain text from binary\nwith enough content to pass.',
        ).toString('base64'),
        mimeType: 'application/octet-stream',
        fileName: 'unknown.bin',
      },
    });
    expect(result.content).toContain('Mocked Skill');
  });
});
