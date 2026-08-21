import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// CLI 已拆分为 src/cli/index.ts；直接执行该入口才能触发 Commander 的 main guard。
const CLI_SOURCE = join(process.cwd(), 'src', 'cli', 'index.ts');
const TMP = join(tmpdir(), `devtoolkit-mcp-test-${Date.now()}`);
const PACKAGE_VERSION = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
) as { version: string };

beforeEach(async () => {
  await mkdir(TMP, { recursive: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

/**
 * MCP Server stdio 测试助手：发送一组 JSON-RPC 请求行，收集响应。
 */
type McpResponse = Record<string, unknown> & {
  error?: { code: number };
  id?: number;
  result?: Record<string, unknown>;
};

async function mcpExchange(
  requests: string[],
  env: Record<string, string> = {},
): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', CLI_SOURCE, '--mcp'],
      {
        env: { ...process.env, ...env },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    const responses: Array<Record<string, unknown>> = [];
    const invalidStdoutLines: string[] = [];
    let stderr = '';

    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (d) => (stderr += d));

    let buffer = '';
    child.stdout.on('data', (data) => {
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的最后行
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          responses.push(JSON.parse(line));
        } catch {
          invalidStdoutLines.push(line);
        }
      }
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`MCP 进程异常退出 (${code}): ${stderr}`));
        return;
      }
      if (invalidStdoutLines.length > 0) {
        reject(
          new Error(
            `MCP stdout 包含非 JSON-RPC 内容: ${invalidStdoutLines.join(' | ')}\nstderr: ${stderr}`,
          ),
        );
        return;
      }
      resolve(responses);
    });

    child.on('error', reject);

    // 逐行发送请求
    let delay = 0;
    for (const req of requests) {
      setTimeout(() => {
        child.stdin.write(req + '\n');
      }, delay);
      delay += 100;
    }
    setTimeout(() => child.stdin.end(), delay + 500);
  });
}

describe('MCP Server — 协议握手', () => {
  it('initialize 返回正确的服务器信息', async () => {
    const responses = await mcpExchange([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
    ]);

    expect(responses.length).toBeGreaterThanOrEqual(1);
    const init = responses[0];
    expect(init.jsonrpc).toBe('2.0');
    expect(init.id).toBe(1);
    const initResult = (init as McpResponse).result as Record<
      string,
      Record<string, unknown>
    >;
    expect(initResult.serverInfo.name).toBe('devtoolkit');
    expect(initResult.serverInfo.version).toBe(PACKAGE_VERSION.version);
    expect(initResult.protocolVersion).toBe('2024-11-05');
    expect(initResult.capabilities.tools).toBeDefined();
  });

  it('支持 MCP ping 保活请求', async () => {
    const responses = await mcpExchange([
      '{"jsonrpc":"2.0","id":2,"method":"ping","params":{}}',
    ]);
    expect(responses[0]).toEqual({ jsonrpc: '2.0', id: 2, result: {} });
  });

  it('接受取消通知且通知本身不产生响应', async () => {
    const responses = await mcpExchange([
      '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":999,"reason":"test"}}',
      '{"jsonrpc":"2.0","id":3,"method":"ping","params":{}}',
    ]);
    expect(responses).toEqual([{ jsonrpc: '2.0', id: 3, result: {} }]);
  });
});

describe('MCP Server — tools/list', () => {
  it('返回完整工具集与有效输入契约', async () => {
    const responses = await mcpExchange([
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
    ]);

    const toolsList = responses.find((r) => (r as McpResponse).id === 2) as
      McpResponse | undefined;
    expect(toolsList).toBeDefined();
    const tools =
      ((toolsList as McpResponse).result?.tools as Array<
        Record<string, unknown>
      >) ?? [];
    const toolNames = tools.map((t: Record<string, unknown>) => t.name);
    expect(toolNames).toContain('generate_skill');
    expect(toolNames).toContain('scan_directory');
    expect(toolNames).toContain('eval_skill');
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'scan_code',
        'search_code',
        'convert_rule',
        'sync_rules',
        'export_env',
        'diff_env',
      ]),
    );
    expect(new Set(toolNames).size).toBe(9);

    // 验证 generate_skill 有正确的 inputSchema
    const genSkill = tools.find(
      (t: Record<string, unknown>) => t.name === 'generate_skill',
    ) as
      | {
          inputSchema?: {
            properties?: Record<string, unknown>;
            required?: string[];
          };
        }
      | undefined;
    expect(genSkill?.inputSchema?.properties?.sources).toBeDefined();
    expect(genSkill?.inputSchema?.properties?.agentType).toBeDefined();
    expect(genSkill?.inputSchema?.required).toContain('sources');
    const genProps = genSkill?.inputSchema?.properties as
      Record<string, { maximum?: number }> | undefined;
    expect(genProps?.timeoutMs?.maximum).toBe(600000);
    expect(genProps?.maxOutputTokens?.maximum).toBe(131072);
  });
});

describe('MCP Server — scan_directory 工具', () => {
  it('正确扫描目录并返回文件列表', async () => {
    await writeFile(join(TMP, 'doc1.md'), '# Doc1');
    await writeFile(join(TMP, 'doc2.txt'), 'Doc2');

    const initReq =
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    const req = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'scan_directory',
        arguments: { directory: TMP },
      },
    });

    const responses = await mcpExchange([initReq, req]);
    const toolResult = responses.find((r) => r.id === 2);

    expect(toolResult).toBeDefined();
    const tr = toolResult as McpResponse;
    const trContent = (
      tr.result?.content as Array<{ type: string; text: string }>
    )[0];
    expect(trContent.type).toBe('text');

    const parsed = JSON.parse(trContent.text);
    expect(parsed.directory).toBe(TMP);
    expect(parsed.fileCount).toBe(2);
    expect(parsed.files.some((f: string) => f.endsWith('doc1.md'))).toBe(true);
  });
});

describe('MCP Server — 错误处理', () => {
  it('未知方法返回 -32601', async () => {
    const responses = await mcpExchange([
      '{"jsonrpc":"2.0","id":99,"method":"unknown/method","params":{}}',
    ]);

    const err = responses.find((r) => (r as McpResponse).id === 99) as
      McpResponse | undefined;
    expect(err?.error).toBeDefined();
    expect(err?.error?.code).toBe(-32601);
  });

  it('无效 JSON 返回 -32700', async () => {
    const responses = await mcpExchange(['{invalid json}']);

    const parseError = responses[0];
    expect((parseError as McpResponse).error).toBeDefined();
    expect((parseError as McpResponse).error?.code).toBe(-32700);
  });

  it('无效 JSON-RPC 请求返回 -32600 且不会导致进程崩溃', async () => {
    const responses = await mcpExchange([
      'null',
      '{"jsonrpc":"2.0","id":7,"method":123}',
    ]);

    expect(responses).toHaveLength(2);
    expect((responses[0] as McpResponse).error?.code).toBe(-32600);
    expect((responses[1] as McpResponse).id).toBe(7);
    expect((responses[1] as McpResponse).error?.code).toBe(-32600);
  });

  it('tools/call 参数结构错误返回 -32602', async () => {
    const responses = await mcpExchange([
      '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":[]}',
    ]);
    expect((responses[0] as McpResponse).error?.code).toBe(-32600);

    const invalidArgs = await mcpExchange([
      '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"scan_code","arguments":[]}}',
    ]);
    expect(
      (invalidArgs[0] as Record<string, unknown>).error &&
        (
          (invalidArgs[0] as Record<string, Record<string, unknown>>)
            .error as Record<string, unknown>
        ).code,
    ).toBe(-32602);
  });

  it('generate_skill 缺少 sources 参数时返回错误', async () => {
    const req = JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'generate_skill',
        arguments: {},
      },
    });

    const initReq =
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    const responses = await mcpExchange([initReq, req], {
      DEEPSEEK_API_KEY: 'dummy',
    });
    const toolResult = responses.find((r) => r.id === 2);

    expect(toolResult).toBeDefined();
    expect((toolResult as McpResponse).result?.isError).toBe(true);
  });
});
