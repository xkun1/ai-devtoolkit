/**
 * Pipeline 编排测试 — 用本地 markdown 模拟全流程
 * 通过 mock LLM 调用验证 pipeline 编排逻辑，不依赖真实 API
 */
import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

// Mock LLM 调用
vi.mock('../src/transform/llm.js', () => ({
  callLLM: vi.fn().mockResolvedValue('# Mocked Skill\n\n- This is a test skill'),
}));

describe('Pipeline E2E (mocked LLM)', () => {
  it('完整跑通：本地 MD → load → transform → format → write', async () => {
    // 准备临时 markdown 文件
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-test-'));
    const mdPath = join(dir, 'test-doc.md');
    await writeFile(mdPath, '# Test API\n\nThis is a test document about an API.\n\n## Usage\n\n```bash\ncurl https://api.test.com\n```\n');
    const outPath = join(dir, 'SKILL.md');

    // 执行 pipeline
    const result = await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    // 验证返回结构
    expect(result.agentType).toBe('codex');
    expect(result.suggestedPath).toBe(outPath);
    expect(result.content).toContain('Mocked Skill');

    // 验证文件确实写入了
    const written = await readFile(outPath, 'utf-8');
    expect(written).toContain('Mocked Skill');
    expect(written).toMatch(/\n$/); // 确保以换行结尾
  });

  it('cursor 类型正确生成 .cursorrules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-cursor-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(mdPath, '# Cursor Rules Doc\n\nFollow these conventions when writing code in this project. Always use TypeScript and prefer functional components over class components. Use named exports instead of default exports.\n');
    const outPath = join(dir, '.cursorrules');

    const result = await runPipeline(mdPath, {
      agentType: 'cursor',
      outputPath: outPath,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    expect(result.agentType).toBe('cursor');
    expect(result.suggestedPath).toBe(outPath);
    const written = await readFile(outPath, 'utf-8');
    expect(written).toContain('Mocked');
  });

  it('内容过短时报错', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-short-'));
    const mdPath = join(dir, 'short.md');
    await writeFile(mdPath, 'hi'); // 只有2字符

    await expect(
      runPipeline(mdPath, {
        agentType: 'codex',
        llm: { apiKey: 'mock-key', model: 'mock-model' },
      }),
    ).rejects.toThrow('文档内容过短');
  });
});
