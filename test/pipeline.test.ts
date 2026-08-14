/**
 * Pipeline 编排测试 — 用本地 markdown 模拟全流程
 * 通过 mock LLM 调用验证 pipeline 编排逻辑，不依赖真实 API
 */
import { describe, it, expect, vi } from 'vitest';
import { runPipeline } from '../src/pipeline.js';
import { mkdtemp, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { callLLM } from '../src/transform/llm.js';

// Mock LLM 调用
vi.mock('../src/transform/llm.js', () => ({
  callLLM: vi
    .fn()
    .mockResolvedValue('# Mocked Skill\n\n- This is a test skill'),
}));

describe('Pipeline E2E (mocked LLM)', () => {
  it('完整跑通：本地 MD → load → transform → format → write', async () => {
    // 准备临时 markdown 文件
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-test-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-cursor-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-short-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-fm-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-name-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-nofm-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-multi-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-partial-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-stdout-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-dryrun-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-overwrite-'));
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
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-force-'));
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

  it('目录批量模式默认保留覆盖保护', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-batch-overwrite-'));
    const docsDir = join(dir, 'docs');
    await mkdir(docsDir, { recursive: true });
    await writeFile(
      join(docsDir, 'guide.md'),
      '# Batch Guide\n\nDocumentation with enough content to verify directory overwrite protection remains enabled.',
    );
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const options = {
        agentType: 'codex' as const,
        llm: { apiKey: 'mock-key', model: 'mock-model' },
      };
      await runPipeline(docsDir, options);
      await expect(runPipeline(docsDir, options)).rejects.toThrow('文件已存在');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('未指定输出路径时使用现代 Codex 技能目录', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-modern-'));
    const mdPath = join(dir, 'modern.md');
    await writeFile(
      mdPath,
      '# Modern Skill\n\nDocumentation with enough content to generate a modern Codex skill directory.',
    );
    const previousCwd = process.cwd();
    process.chdir(dir);
    try {
      const result = await runPipeline(mdPath, {
        agentType: 'codex',
        force: true,
        llm: { apiKey: 'mock-key', model: 'mock-model' },
      });
      expect(result.suggestedPath).toBe('.agents/skills/modern-skill/SKILL.md');
      expect(
        await readFile(join(dir, result.suggestedPath), 'utf-8'),
      ).toContain('name: modern-skill');
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('增量命中返回真实产物且不再次调用 LLM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-cache-'));
    const mdPath = join(dir, 'cached.md');
    const outPath = join(dir, 'SKILL.md');
    await writeFile(
      mdPath,
      '# Cached Skill\n\nDocumentation with enough stable content for incremental cache verification.',
    );
    vi.mocked(callLLM).mockClear();
    const options = {
      agentType: 'codex' as const,
      outputPath: outPath,
      force: false,
      incremental: true,
      llm: { apiKey: 'mock-key', model: 'mock-model' },
    };
    const first = await runPipeline(mdPath, options);
    const callsAfterFirst = vi.mocked(callLLM).mock.calls.length;
    const second = await runPipeline(mdPath, options);

    expect(second.content).toBe(first.content);
    expect(second.stats?.cacheHit).toBe(true);
    expect(vi.mocked(callLLM)).toHaveBeenCalledTimes(callsAfterFirst);
  });

  it('增量模式下模型参数变化会重新调用 LLM', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-cache-model-'));
    const mdPath = join(dir, 'cached.md');
    const outPath = join(dir, 'SKILL.md');
    await writeFile(
      mdPath,
      '# Fingerprint Skill\n\nDocumentation with enough stable content for fingerprint verification.',
    );
    vi.mocked(callLLM).mockClear();
    await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      incremental: true,
      llm: { apiKey: 'mock-key', model: 'model-a' },
    });
    const callsAfterFirst = vi.mocked(callLLM).mock.calls.length;
    await runPipeline(mdPath, {
      agentType: 'codex',
      outputPath: outPath,
      incremental: true,
      force: true,
      llm: { apiKey: 'mock-key', model: 'model-b' },
    });
    expect(vi.mocked(callLLM).mock.calls.length).toBeGreaterThan(
      callsAfterFirst,
    );
  });
});
