import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const readlineMock = vi.hoisted(() => ({
  createInterface: vi.fn(),
  line: undefined as ((line: string) => void) | undefined,
}));
const toolMock = vi.hoisted(() => ({ handleToolCall: vi.fn() }));

vi.mock('node:readline', () => ({
  createInterface: (...args: unknown[]) => {
    readlineMock.createInterface(...args);
    return {
      on: vi.fn((event: string, callback: (line: string) => void) => {
        if (event === 'line') readlineMock.line = callback;
      }),
    };
  },
}));
vi.mock('../src/mcp/handlers.js', () => toolMock);
vi.mock('../src/utils/logger.js', () => ({
  info: vi.fn(),
  setLogToStderr: vi.fn(),
}));

import { startMcpServer } from '../src/mcp-server.js';
import { OperationAbortedError } from '../src/utils/abort.js';

describe('MCP Server 单元协议处理', () => {
  let write: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    readlineMock.line = undefined;
    toolMock.handleToolCall.mockResolvedValue({ ok: true });
    write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => write.mockRestore());

  function start(options: Record<string, unknown> = {}) {
    startMcpServer(options);
    expect(readlineMock.line).toBeDefined();
    return readlineMock.line!;
  }

  async function send(line: (line: string) => void, value: unknown) {
    line(typeof value === 'string' ? value : JSON.stringify(value));
    await vi.waitFor(() => expect(write).toHaveBeenCalled());
    const raw = write.mock.calls.at(-1)?.[0] as string;
    return JSON.parse(raw.trim());
  }

  it('处理握手、ping、通知、工具列表和未知方法', async () => {
    const line = start();
    expect(
      await send(line, { jsonrpc: '2.0', id: 1, method: 'initialize' }),
    ).toMatchObject({
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'devtoolkit' },
      },
    });
    expect(await send(line, { jsonrpc: '2.0', id: 2, method: 'ping' })).toEqual(
      {
        jsonrpc: '2.0',
        id: 2,
        result: {},
      },
    );
    line('   ');
    line(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    );
    const list = await send(line, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    });
    expect(list.result.tools.length).toBeGreaterThan(0);
    expect(
      await send(line, { jsonrpc: '2.0', id: 4, method: 'nope' }),
    ).toMatchObject({
      error: { code: -32601 },
    });
  });

  it('处理 JSON 解析错误和无效请求', async () => {
    const line = start();
    expect(await send(line, '{bad')).toMatchObject({
      error: { code: -32700 },
      id: null,
    });
    expect(await send(line, null)).toMatchObject({
      error: { code: -32600 },
      id: null,
    });
    expect(
      await send(line, { jsonrpc: '2.0', id: 8, method: 'ping', params: [] }),
    ).toMatchObject({ id: 8, error: { code: -32600 } });
    expect(
      await send(line, {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: {},
      }),
    ).toMatchObject({ id: 9, error: { code: -32602 } });
    expect(
      await send(line, {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'x', arguments: [] },
      }),
    ).toMatchObject({ id: 10, error: { code: -32602 } });
  });

  it('成功调用工具并传递默认配置和上下文', async () => {
    const line = start({
      model: 'm',
      requestTimeoutMs: 10_000,
      llmTimeoutMs: 20_000,
      maxOutputChars: 123,
      maxOutputTokens: 456,
    });
    toolMock.handleToolCall.mockResolvedValueOnce('plain result');
    const response = await send(line, {
      jsonrpc: '2.0',
      id: 'a',
      method: 'tools/call',
      params: { name: 'demo', arguments: { x: 1 } },
    });
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 'a',
      result: { content: [{ type: 'text', text: 'plain result' }] },
    });
    expect(toolMock.handleToolCall).toHaveBeenCalledWith(
      'demo',
      { x: 1 },
      expect.objectContaining({
        defaults: expect.objectContaining({ model: 'm' }),
        llmTimeoutMs: 20_000,
        maxOutputChars: 123,
        maxOutputTokens: 456,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('工具对象结果序列化、普通错误和取消错误均返回协议响应', async () => {
    const line = start();
    toolMock.handleToolCall.mockRejectedValueOnce(new Error('boom'));
    expect(
      await send(line, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'x' },
      }),
    ).toMatchObject({
      id: 1,
      result: { isError: true, content: [{ text: '❌ 错误: boom' }] },
    });
    toolMock.handleToolCall.mockResolvedValueOnce({ answer: 42 });
    const objectResult = await send(line, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'x' },
    });
    expect(objectResult.result.content[0].text).toContain('"answer": 42');
    toolMock.handleToolCall.mockRejectedValueOnce(
      new OperationAbortedError('cancelled'),
    );
    expect(
      await send(line, {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'x' },
      }),
    ).toMatchObject({ id: 3, error: { code: -32800, message: 'cancelled' } });
  });

  it('输出超过限制、重复请求和取消通知被正确处理', async () => {
    const line = start({ maxToolResultBytes: 3 });
    toolMock.handleToolCall.mockResolvedValueOnce('toolong');
    expect(
      await send(line, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'x' },
      }),
    ).toMatchObject({ id: 1, result: { isError: true } });

    let resolvePending!: (value: string) => void;
    toolMock.handleToolCall.mockImplementationOnce(
      () => new Promise<string>((resolve) => (resolvePending = resolve)),
    );
    line(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'x' },
      }),
    );
    const duplicate = await send(line, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'x' },
    });
    expect(duplicate).toMatchObject({ id: 2, error: { code: -32600 } });
    resolvePending('ok');
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(3));

    let rejectCancelled!: (error: Error) => void;
    toolMock.handleToolCall.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectCancelled = reject)),
    );
    line(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'x' },
      }),
    );
    line(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 4, reason: 'stop' },
      }),
    );
    rejectCancelled(new OperationAbortedError('stop'));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(4));
    expect(
      JSON.parse((write.mock.calls.at(-1)?.[0] as string).trim()),
    ).toMatchObject({
      id: 4,
      error: { code: -32800 },
    });
  });

  it.each([
    ['requestTimeoutMs', 0],
    ['llmTimeoutMs', Number.NaN],
    ['maxToolResultBytes', 100 * 1024 * 1024 + 1],
    ['maxOutputChars', 1.5],
    ['maxOutputTokens', -1],
  ])('拒绝非法运行参数 %s', (key, value) => {
    expect(() => startMcpServer({ [key]: value })).toThrow(`${key} 必须是`);
  });
});
