/**
 * MCP (Model Context Protocol) Server — stdio 模式
 *
 * 让 devtoolkit 作为 AI Agent 的原生工具使用。
 * AI Agent 通过 MCP 协议调用 `generate_skill`、`search_code`、`convert_rule`、`sync_rules` 等工具。
 *
 * 用法:
 *   npx ai-devtoolkit --mcp
 *
 * Claude Desktop / Cursor 等 MCP 客户端配置示例:
 *   {
 *     "mcpServers": {
 *       "devtoolkit": {
 *         "command": "npx",
 *         "args": ["-y", "ai-devtoolkit", "--mcp"]
 *       }
 *     }
 *   }
 */
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { info, setLogToStderr } from './utils/logger.js';
import { TOOLS } from './mcp/tools.js';
import { handleToolCall } from './mcp/handlers.js';
import type { McpServerOptions, McpToolContext } from './mcp/types.js';
import {
  getRequestId,
  isJsonRpcRequest,
  isRecord,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from './mcp/protocol.js';
import {
  ResourceLimitError,
  createAbortScope,
  isAbortError,
} from './utils/abort.js';
import {
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from './transform/llm.js';

export type { McpServerOptions } from './mcp/types.js';

const DEFAULT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_TOOL_RESULT_BYTES = 1024 * 1024;

interface McpRuntime {
  defaults: McpServerOptions;
  activeRequests: Map<string | number, AbortController>;
  requestTimeoutMs: number;
  llmTimeoutMs: number;
  maxToolResultBytes: number;
  maxOutputChars: number;
  maxOutputTokens: number;
}

// ── MCP 工具定义 ──

const SERVER_INFO = {
  name: 'devtoolkit',
  version: readPackageVersion(),
};

const CAPABILITIES = {
  tools: {},
};

// ── MCP Server 核心逻辑 ──

export function startMcpServer(options: McpServerOptions = {}): void {
  const runtime = createRuntime(options);

  // stdio 传输的 stdout 必须只包含 JSON-RPC 消息。
  setLogToStderr(true);
  info('🚀 devtoolkit MCP Server 启动中 (stdio 模式)...');

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isJsonRpcRequest(parsed)) {
        sendResponse({
          jsonrpc: '2.0',
          id: getRequestId(parsed),
          error: { code: -32600, message: 'Invalid Request' },
        });
        return;
      }
      void handleRequest(parsed, runtime).catch((err: unknown) => {
        if (parsed.id === undefined) return;
        sendResponse({
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32603,
            message: 'Internal error',
            data: err instanceof Error ? err.message : String(err),
          },
        });
      });
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error: invalid JSON',
        },
      });
    }
  });

  // stdin 关闭后让进行中的文件或网络任务自然完成，避免丢失最后一条响应。
}

function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

async function handleRequest(
  request: JsonRpcRequest,
  runtime: McpRuntime,
): Promise<void> {
  const { method, id, params = {} } = request;

  switch (method) {
    case 'initialize':
      if (id === undefined) break;
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: SERVER_INFO,
          capabilities: CAPABILITIES,
        },
      });
      break;

    case 'notifications/initialized':
      break;

    case 'notifications/cancelled': {
      const requestId = isRecord(params) ? params.requestId : undefined;
      if (typeof requestId === 'string' || typeof requestId === 'number') {
        runtime.activeRequests
          .get(requestId)
          ?.abort(new Error(`MCP 请求已取消: ${String(params.reason || '')}`));
      }
      break;
    }

    case 'ping':
      if (id !== undefined) {
        sendResponse({ jsonrpc: '2.0', id, result: {} });
      }
      break;

    case 'tools/list':
      if (id === undefined) break;
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
      break;

    case 'tools/call': {
      if (!isRecord(params) || typeof params.name !== 'string') {
        if (id !== undefined) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params' },
          });
        }
        break;
      }
      const toolName = params.name;
      const rawArgs = params.arguments;
      if (rawArgs !== undefined && !isRecord(rawArgs)) {
        if (id !== undefined) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params' },
          });
        }
        break;
      }
      const args = rawArgs || {};
      const controller = new AbortController();
      const requestKey =
        typeof id === 'string' || typeof id === 'number' ? id : undefined;
      if (requestKey !== undefined) {
        const existing = runtime.activeRequests.get(requestKey);
        if (existing) {
          sendResponse({
            jsonrpc: '2.0',
            id: requestKey,
            error: { code: -32600, message: 'Duplicate request id' },
          });
          break;
        }
        runtime.activeRequests.set(requestKey, controller);
      }
      const scope = createAbortScope(
        controller.signal,
        runtime.requestTimeoutMs,
        `MCP 工具 ${toolName}`,
      );
      const toolContext: McpToolContext = {
        defaults: runtime.defaults,
        signal: scope.signal,
        llmTimeoutMs: runtime.llmTimeoutMs,
        maxOutputChars: runtime.maxOutputChars,
        maxOutputTokens: runtime.maxOutputTokens,
      };

      try {
        const result = await handleToolCall(toolName, args, toolContext);
        if (id !== undefined) {
          const text =
            typeof result === 'string'
              ? result
              : JSON.stringify(result, null, 2);
          if (Buffer.byteLength(text, 'utf-8') > runtime.maxToolResultBytes) {
            throw new ResourceLimitError(
              `MCP 工具输出超过 ${runtime.maxToolResultBytes} 字节限制`,
            );
          }
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text,
                },
              ],
            },
          });
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (id !== undefined) {
          if (isAbortError(err) || scope.signal.aborted) {
            sendResponse({
              jsonrpc: '2.0',
              id,
              error: { code: -32800, message: errMsg },
            });
          } else {
            sendResponse({
              jsonrpc: '2.0',
              id,
              result: {
                content: [{ type: 'text', text: `❌ 错误: ${errMsg}` }],
                isError: true,
              },
            });
          }
        }
      } finally {
        scope.dispose();
        if (requestKey !== undefined) {
          runtime.activeRequests.delete(requestKey);
        }
      }
      break;
    }

    default:
      if (id !== undefined) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
      }
  }
}

function createRuntime(options: McpServerOptions): McpRuntime {
  return {
    defaults: options,
    activeRequests: new Map(),
    requestTimeoutMs: normalizePositiveInteger(
      options.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      60 * 60_000,
      'requestTimeoutMs',
    ),
    llmTimeoutMs: normalizePositiveInteger(
      options.llmTimeoutMs,
      DEFAULT_LLM_TIMEOUT_MS,
      10 * 60_000,
      'llmTimeoutMs',
    ),
    maxToolResultBytes: normalizePositiveInteger(
      options.maxToolResultBytes,
      DEFAULT_MAX_TOOL_RESULT_BYTES,
      100 * 1024 * 1024,
      'maxToolResultBytes',
    ),
    maxOutputChars: normalizePositiveInteger(
      options.maxOutputChars,
      DEFAULT_MAX_OUTPUT_CHARS,
      10 * 1024 * 1024,
      'maxOutputChars',
    ),
    maxOutputTokens: normalizePositiveInteger(
      options.maxOutputTokens,
      DEFAULT_MAX_OUTPUT_TOKENS,
      131_072,
      'maxOutputTokens',
    ),
  };
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const normalized = value ?? fallback;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 1 ||
    normalized > maximum
  ) {
    throw new RangeError(`${label} 必须是 1-${maximum} 的整数`);
  }
  return normalized;
}

function readPackageVersion(): string {
  try {
    const packagePath = join(__dirname, '..', 'package.json');
    const parsed = JSON.parse(readFileSync(packagePath, 'utf-8')) as {
      version?: unknown;
    };
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
