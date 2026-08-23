import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';

const execFileAsync = promisify(execFile);
const cliPath = resolve(process.cwd(), 'bin/cli.js');

const sourceContent = `# 团队 API 开发规范

这是用于端到端测试的文档，包含足够的正文内容以验证加载、提示词构造和技能包输出流程。

## 请求约定

所有请求必须携带认证信息，并在失败时返回结构化错误。`;

const generatedSkill = `---
name: e2e-skill
description: "端到端测试生成的技能包"
globs: "**/*"
alwaysApply: false
---

# 团队 API 开发技能

## 使用规则

遵循统一的认证、请求和错误处理约定。`;

async function startMockLlm(): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((request, response) => {
    if (
      request.method !== 'POST' ||
      !request.url?.endsWith('/chat/completions')
    ) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'e2e-response',
        object: 'chat.completion',
        choices: [{ message: { role: 'assistant', content: generatedSkill } }],
      }),
    );
  });
  await new Promise<void>((resolveServer) =>
    server.listen(0, '127.0.0.1', resolveServer),
  );
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('无法启动 E2E LLM mock server');
  }
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function runCli(
  cwd: string,
  sourcePath: string,
  baseUrl: string,
  agent: Agent,
  outputPath: string,
  stdout = false,
): Promise<{ stdout: string; stderr: string }> {
  const args = [
    cliPath,
    sourcePath,
    '--type',
    agent,
    '--name',
    'e2e-skill',
    '--model',
    'custom-local',
    '--base-url',
    baseUrl,
    '--local-model',
    'e2e-model',
    '--out',
    outputPath,
    '--llm-timeout',
    '10000',
  ];
  if (stdout) args.push('--stdout', '--dry-run');
  return execFileAsync(process.execPath, args, {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 1024 * 1024,
  });
}

const expectedPaths = {
  codex: ['.agents', 'skills', 'e2e-skill', 'SKILL.md'],
  cursor: ['.cursor', 'rules', 'e2e-skill.mdc'],
  claude: ['.claude', 'skills', 'e2e-skill', 'SKILL.md'],
  windsurf: ['.windsurf', 'rules', 'e2e-skill.md'],
  copilot: ['.github', 'skills', 'e2e-skill', 'SKILL.md'],
  gemini: ['.gemini', 'skills', 'e2e-skill', 'SKILL.md'],
  aider: ['CONVENTIONS.md'],
} as const;

type Agent = keyof typeof expectedPaths;

for (const agent of Object.keys(expectedPaths) as Agent[]) {
  test(`CLI 可生成 ${agent} 技能包并支持 stdout dry-run`, async () => {
    const workspace = await mkdtemp(join(tmpdir(), `devtoolkit-e2e-${agent}-`));
    const sourcePath = join(workspace, 'source.md');
    const outputPath = join(workspace, ...expectedPaths[agent]);
    const dryRunPath = join(workspace, 'dry-run-output.md');
    const { server, baseUrl } = await startMockLlm();

    try {
      await writeFile(sourcePath, sourceContent);

      // 正常模式：验证目标 Agent 的产物路径、YAML frontmatter 和正文。
      await runCli(workspace, sourcePath, baseUrl, agent, outputPath);
      const content = await readFile(outputPath, 'utf8');
      if (agent !== 'aider') {
        expect(content).toMatch(/^---\r?\n[\s\S]*\r?\n---\r?\n/);
      }
      expect(content).toContain('# 团队 API 开发技能');
      expect(content).toContain('统一的认证、请求和错误处理约定');

      // stdout + dry-run：内容输出到标准输出，目标路径不应产生文件。
      const preview = await runCli(
        workspace,
        sourcePath,
        baseUrl,
        agent,
        dryRunPath,
        true,
      );
      if (['codex', 'cursor', 'windsurf'].includes(agent)) {
        expect(preview.stdout).toMatch(/^---\r?\n[\s\S]*\r?\n---\r?\n/);
      }
      expect(preview.stdout).toContain('# 团队 API 开发技能');
      await expect(stat(dryRunPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await new Promise<void>((resolveClose) =>
        server.close(() => resolveClose()),
      );
      await rm(workspace, { recursive: true, force: true });
    }
  });
}
