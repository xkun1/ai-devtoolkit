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
  callLLM: vi
    .fn()
    .mockResolvedValue('# Mocked Skill\n\n- This is a test skill'),
}));

describe('Pipeline E2E (mocked LLM)', () => {
  it('完整跑通：本地 MD → load → transform → format → write', async () => {
    // 准备临时 markdown 文件
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-test-'));
    const mdPath = join(dir, 'test-doc.md');
    await writeFile(
      mdPath,
      '# Test API\n\nThis is a test document about an API.\n\n## Usage\n\n```bash\ncurl https://api.test.com\n```\n',
    );
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
    await writeFile(
      mdPath,
      '# Cursor Rules Doc\n\nFollow these conventions when writing code in this project. Always use TypeScript and prefer functional components over class components. Use named exports instead of default exports.\n',
    );
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

  it('codex 类型自动注入 frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-fm-'));
    const mdPath = join(dir, 'my-api-docs.md');
    await writeFile(
      mdPath,
      '# My API\n\nDocumentation about my API. It has enough content to pass the minimum length check for the pipeline.\n',
    );
    const outPath = join(dir, 'SKILL.md');

    const result = await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    // frontmatter 在最前面，name 从标题 slugify
    expect(result.content).toMatch(
      /^---\nname: my-api\ndescription: ".+"\n---\n\n/,
    );
    expect(result.content).toContain('Mocked Skill');
  });

  it('--name 自定义技能名覆盖默认值', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-name-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(
      mdPath,
      '# Some Title\n\nDocumentation with enough content to pass the minimum length check for the pipeline to proceed.\n',
    );
    const outPath = join(dir, 'SKILL.md');

    const result = await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      name: 'custom-skill-name',
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    expect(result.content).toContain('name: custom-skill-name');
  });

  it('cursor 类型不注入 frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-nofm-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(
      mdPath,
      '# Cursor Doc\n\nDocumentation with enough content to pass the minimum length check for the pipeline to proceed.\n',
    );
    const outPath = join(dir, '.cursorrules');

    const result = await runPipeline(mdPath, {
      agentType: 'cursor',
      outputPath: outPath,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    expect(result.content).not.toMatch(/^---\nname:/);
  });

  it('多 source 合并：两个文件合并提炼', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-multi-'));
    const md1 = join(dir, 'part1.md');
    const md2 = join(dir, 'part2.md');
    await writeFile(
      md1,
      '# Part One\n\nFirst document with enough content to be meaningful for the merge test case.\n',
    );
    await writeFile(
      md2,
      '# Part Two\n\nSecond document with enough content to be meaningful for the merge test case.\n',
    );
    const outPath = join(dir, 'SKILL.md');

    const result = await runPipeline([md1, md2], {
      agentType: 'codex',
      outputPath: outPath,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    expect(result.agentType).toBe('codex');
    const written = await readFile(outPath, 'utf-8');
    expect(written).toContain('Mocked Skill');
  });

  it('多 source 中任一失败即整体失败', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-partial-'));
    const md1 = join(dir, 'exists.md');
    await writeFile(
      md1,
      '# Exists\n\nThis file exists with enough content for the test to reach the loading phase properly.\n',
    );

    await expect(
      runPipeline([md1, join(dir, 'not-exists.md')], {
        agentType: 'codex',
        llm: { apiKey: 'mock-key', model: 'mock-model' },
      }),
    ).rejects.toThrow('加载');
  });

  it('stdout 模式：不写文件，内容经 stdout 输出', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-stdout-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(
      mdPath,
      '# Stdout Test\n\nDocumentation with enough content to pass the minimum length check for stdout mode testing.\n',
    );
    const outPath = join(dir, 'should-not-exist.md');

    // 拦截 stdout 写入
    const chunks: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: any) => {
      chunks.push(String(chunk));
      return true;
    }) as any;

    try {
      const result = await runPipeline(mdPath, {
        agentType: 'codex',
        outputPath: outPath,
        stdout: true,
        llm: { apiKey: 'mock-key', model: 'mock-model' },
      });

      // stdout 收到了内容
      expect(chunks.join('')).toContain('Mocked Skill');
      expect(result.content).toContain('Mocked Skill');
      // 文件未写入
      await expect(readFile(outPath, 'utf-8')).rejects.toThrow();
    } finally {
      process.stdout.write = originalWrite;
    }
  });
  it('dry-run 模式：预览内容，不写文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-dryrun-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(
      mdPath,
      '# Dry Run Test\n\nDocumentation with enough content to pass the minimum length check for dry run mode testing.\n',
    );
    const outPath = join(dir, 'should-not-exist.md');

    const result = await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      dryRun: true,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    // 结果内容正常返回
    expect(result.content).toContain('Mocked Skill');
    // 文件未写入
    await expect(readFile(outPath, 'utf-8')).rejects.toThrow();
  });

  it('覆盖保护：文件已存在时拒绝写入', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-overwrite-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(
      mdPath,
      '# Overwrite Test\n\nDocumentation with enough content to pass the minimum length check for overwrite protection testing.\n',
    );
    const outPath = join(dir, 'SKILL.md');
    // 预先创建文件
    await writeFile(outPath, 'existing content');

    await expect(
      runPipeline(mdPath, {
        agentType: 'codex',
        outputPath: outPath,
        llm: { apiKey: 'mock-key', model: 'mock-model' },
      }),
    ).rejects.toThrow('文件已存在');
  });

  it('--force 覆盖已存在文件', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'doc2skill-force-'));
    const mdPath = join(dir, 'doc.md');
    await writeFile(
      mdPath,
      '# Force Test\n\nDocumentation with enough content to pass the minimum length check for force overwrite testing.\n',
    );
    const outPath = join(dir, 'SKILL.md');
    await writeFile(outPath, 'old content');

    await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      force: true,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    });

    // 文件被覆盖
    const written = await readFile(outPath, 'utf-8');
    expect(written).toContain('Mocked Skill');
  });
});
