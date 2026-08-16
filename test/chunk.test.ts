import { describe, expect, it, vi, beforeEach } from 'vitest';
import { splitDocument } from '../src/transform/chunk.js';
import { transformDocumentToSkill } from '../src/transform/index.js';
import { callLLM } from '../src/transform/llm.js';

vi.mock('../src/transform/llm.js', () => ({
  callLLM: vi.fn().mockResolvedValue('提炼结果'),
}));

describe('splitDocument', () => {
  it('所有分块可无损还原原文', () => {
    const content = Array.from(
      { length: 40 },
      (_, i) => `## Section ${i}\n\n${'中文内容😀 '.repeat(80)}\n`,
    ).join('\n');
    const chunks = splitDocument(content, 2_000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(content);
    expect(chunks[0].start).toBe(0);
    expect(chunks.at(-1)?.end).toBe(content.length);
  });

  it('常规 fenced code block 不会被切开', () => {
    const code = `\`\`\`ts\n${'const value = 1;\n'.repeat(40)}\`\`\`\n`;
    const content = `${'# Intro\n\n' + 'a'.repeat(400)}\n\n${code}\n## Next\n${'b'.repeat(900)}`;
    const chunks = splitDocument(content, 1_000);
    const containingFence = chunks.filter((chunk) =>
      chunk.content.includes('```'),
    );

    expect(containingFence).toHaveLength(1);
    expect(chunks.map((chunk) => chunk.content).join('')).toBe(content);
  });
});

describe('transformDocumentToSkill', () => {
  beforeEach(() => vi.mocked(callLLM).mockClear());

  it('长文档逐块处理后再合成，不静默截断', async () => {
    const content = Array.from(
      { length: 8 },
      (_, i) => `## Topic ${i}\n${String(i).repeat(1_100)}\n`,
    ).join('\n');
    const result = await transformDocumentToSkill(
      { source: 'large.md', type: 'markdown', title: 'Large', content },
      { apiKey: 'mock', model: 'mock' },
      'codex',
      undefined,
      undefined,
      { chunkChars: 2_000, concurrency: 2 },
    );

    expect(result.stats.sourceChunks).toBeGreaterThan(1);
    expect(result.stats.processedChars).toBe(content.length);
    expect(result.stats.llmCalls).toBe(result.stats.sourceChunks + 1);
    expect(callLLM).toHaveBeenCalledTimes(result.stats.llmCalls);
    const prompts = vi.mocked(callLLM).mock.calls.map(([prompt]) => prompt);
    expect(prompts.join('\n')).toContain(content.slice(-300));
    expect(prompts.at(-1)).toContain('Long-document synthesis constraints');
  });

  it('超过 LLM 调用预算时立即停止', async () => {
    const content = Array.from(
      { length: 4 },
      (_, index) => `## Topic ${index}\n${'x'.repeat(1_200)}\n`,
    ).join('\n');
    await expect(
      transformDocumentToSkill(
        { source: 'budget.md', type: 'markdown', content },
        { apiKey: 'mock', model: 'mock' },
        'codex',
        undefined,
        undefined,
        { chunkChars: 1_500, concurrency: 1, maxLLMCalls: 1 },
      ),
    ).rejects.toThrow('1 次 LLM 调用');
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('预先取消时不调用 LLM', async () => {
    const controller = new AbortController();
    controller.abort(new Error('停止提炼'));
    await expect(
      transformDocumentToSkill(
        {
          source: 'cancel.md',
          type: 'markdown',
          content: '足够长的文档内容'.repeat(20),
        },
        { apiKey: 'mock', model: 'mock' },
        'codex',
        undefined,
        undefined,
        { signal: controller.signal },
      ),
    ).rejects.toThrow('停止提炼');
    expect(callLLM).not.toHaveBeenCalled();
  });
});
