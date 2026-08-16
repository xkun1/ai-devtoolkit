import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleToolCall } from '../src/mcp/handlers.js';
import {
  getRequestId,
  isJsonRpcRequest,
  isRecord,
} from '../src/mcp/protocol.js';
import type { McpToolContext } from '../src/mcp/types.js';

function createContext(signal = new AbortController().signal): McpToolContext {
  return {
    defaults: {},
    signal,
    llmTimeoutMs: 120_000,
    maxOutputChars: 1024 * 1024,
    maxOutputTokens: 8_192,
  };
}

describe('MCP 协议模块', () => {
  it('严格校验 JSON-RPC 请求结构', () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(
      isJsonRpcRequest({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} }),
    ).toBe(true);
    expect(isJsonRpcRequest({ jsonrpc: '1.0', method: 'ping' })).toBe(false);
    expect(isJsonRpcRequest({ jsonrpc: '2.0', method: 123 })).toBe(false);
    expect(getRequestId({ id: 'request-1' })).toBe('request-1');
    expect(getRequestId({ id: null })).toBeNull();
  });
});

describe('MCP 工具处理模块', () => {
  it('可直接执行目录扫描与规则转换', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'devtoolkit-mcp-module-'));
    await writeFile(join(dir, 'guide.md'), '# Guide');

    const scanned = await handleToolCall(
      'scan_directory',
      { directory: dir },
      createContext(),
    );
    expect(scanned).toEqual(
      expect.objectContaining({ directory: dir, fileCount: 1 }),
    );

    const converted = await handleToolCall(
      'convert_rule',
      {
        to: 'codex',
        ruleContent: '# 测试规则\n\n所有变更都必须运行测试。',
      },
      createContext(),
    );
    expect(converted).toEqual(
      expect.objectContaining({ success: true, to: 'codex' }),
    );
  });

  it('预先取消时不执行工具', async () => {
    const controller = new AbortController();
    controller.abort(new Error('取消 MCP 工具'));
    await expect(
      handleToolCall('scan_code', {}, createContext(controller.signal)),
    ).rejects.toThrow('取消 MCP 工具');
  });

  it('拒绝越界资源参数', async () => {
    await expect(
      handleToolCall(
        'scan_directory',
        { directory: process.cwd(), maxFiles: 10_001 },
        createContext(),
      ),
    ).rejects.toThrow('maxFiles');

    await expect(
      handleToolCall(
        'generate_skill',
        {
          sources: ['guide.md'],
          apiKey: 'dummy',
          maxBatchFiles: 101,
        },
        createContext(),
      ),
    ).rejects.toThrow('maxBatchFiles');

    await expect(
      handleToolCall(
        'eval_skill',
        {
          skillContent: '# Skill\n\n规则正文',
          apiKey: 'dummy',
          concurrency: 5,
        },
        createContext(),
      ),
    ).rejects.toThrow('concurrency');
  });
});
