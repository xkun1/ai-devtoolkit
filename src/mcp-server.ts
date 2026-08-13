/**
 * MCP (Model Context Protocol) Server — stdio 模式
 *
 * 让 doc2skill 作为 AI Agent 的原生工具使用。
 * AI Agent 通过 MCP 协议调用 `generate_skill` 工具，
 * 直接把文档/URL 转化为技能包。
 *
 * 用法:
 *   doc2skill --mcp
 *
 * Claude Desktop / Cursor 等 MCP 客户端配置示例:
 *   {
 *     "mcpServers": {
 *       "doc2skill": {
 *         "command": "npx",
 *         "args": ["doc2skill", "--mcp"]
 *       }
 *     }
 *   }
 */
import { createInterface } from 'node:readline';
import type { AgentType, SkillResult } from './types/index.js';
import { runPipeline } from './pipeline.js';
import { resolveModel, isLocalModel } from './models.js';
import { info } from './utils/logger.js';

// ── MCP 协议类型 ──

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// ── MCP 工具定义 ──

const SERVER_INFO = {
  name: 'doc2skill',
  version: '0.7.0',
};

const CAPABILITIES = {
  tools: {},
};

/** generate_skill 工具的 JSON Schema 输入定义 */
const GENERATE_SKILL_SCHEMA = {
  type: 'object' as const,
  properties: {
    sources: {
      type: 'array',
      items: { type: 'string' },
      description:
        '文档来源列表：URL 或本地文件路径。支持 .md/.pdf/.docx/.html/.txt 等',
    },
    agentType: {
      type: 'string',
      enum: ['codex', 'cursor', 'claude'],
      description: '目标 AI Agent 类型（默认 codex）',
    },
    name: {
      type: 'string',
      description: '自定义技能名（用于技能包标识）',
    },
    template: {
      type: 'string',
      description: '预设模板 ID（如 api-doc / coding-guide / cheatsheet）',
    },
    model: {
      type: 'string',
      description: 'LLM 模型名（默认 deepseek-chat）',
    },
    baseUrl: {
      type: 'string',
      description: 'LLM API Base URL（覆盖预设）',
    },
    apiKey: {
      type: 'string',
      description:
        'API Key（建议用环境变量 DEEPSEEK_API_KEY 或 OPENAI_API_KEY）',
    },
    outputPath: {
      type: 'string',
      description: '输出文件路径（不指定则使用默认路径）',
    },
    force: {
      type: 'boolean',
      description: '强制覆盖已存在的文件',
    },
    dryRun: {
      type: 'boolean',
      description: '预览结果，不写入文件',
    },
  },
  required: ['sources'],
};

/** 扫描目录工具的 JSON Schema */
const SCAN_DIRECTORY_SCHEMA = {
  type: 'object' as const,
  properties: {
    directory: {
      type: 'string',
      description: '要扫描的目录路径',
    },
    maxDepth: {
      type: 'number',
      description: '最大递归深度（默认 5）',
    },
  },
  required: ['directory'],
};

const TOOLS = [
  {
    name: 'generate_skill',
    description:
      '将文档（URL/PDF/Markdown/DOCX 等）转化为 AI Agent 技能包。支持批量目录处理。',
    inputSchema: GENERATE_SKILL_SCHEMA,
  },
  {
    name: 'scan_directory',
    description:
      '扫描目录，返回所有受支持的文档文件列表（可用于 preview 后再调用 generate_skill）。',
    inputSchema: SCAN_DIRECTORY_SCHEMA,
  },
];

// ── MCP 协议处理 ──

export interface McpServerOptions {
  /** LLM 模型名（默认从环境变量或 deepseek-chat） */
  model?: string;
  /** API Base URL */
  baseURL?: string;
  /** API Key */
  apiKey?: string;
  /** 本地模型真实名称 */
  localModelName?: string;
}

/**
 * 启动 MCP Server（stdio JSON-RPC 2.0）
 * 阻塞式 readline 循环，按行读取请求、写入响应。
 */
export function startMcpServer(_options: McpServerOptions = {}): void {
  // MCP stdio：日志走 stderr，stdout 仅用于 JSON-RPC
  setLogToStderrForMcp();

  const rl = createInterface({
    input: process.stdin,
    output: undefined,
    terminal: false,
  });

  info('doc2skill MCP Server 启动（stdio 模式）');

  rl.on('line', (line: string) => {
    if (!line.trim()) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(line);
    } catch {
      sendResponse({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: 无效的 JSON' },
      });
      return;
    }

    handleRequest(request).catch((err) => {
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: 'Internal error',
          data: err instanceof Error ? err.message : String(err),
        },
      });
    });
  });

  rl.on('close', () => {
    info('doc2skill MCP Server 已关闭');
    process.exit(0);
  });
}

/** 发送 JSON-RPC 响应到 stdout */
function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

/** 路由 MCP 请求 */
async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { method, id, params = {} } = request;

  switch (method) {
    case 'initialize':
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
      // 通知无需响应
      break;

    case 'tools/list':
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });
      break;

    case 'tools/call': {
      const toolName = params.name as string;
      const args = (params.arguments as Record<string, unknown>) || {};

      try {
        const result = await handleToolCall(toolName, args);
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text:
                  typeof result === 'string'
                    ? result
                    : JSON.stringify(result, null, 2),
              },
            ],
          },
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `❌ 错误: ${errMsg}` }],
            isError: true,
          },
        });
      }
      break;
    }

    default:
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

/** 处理工具调用 */
async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string | Record<string, unknown>> {
  switch (name) {
    case 'generate_skill':
      return handleGenerateSkill(args);

    case 'scan_directory':
      return handleScanDirectory(args);

    default:
      throw new Error(`未知工具: ${name}`);
  }
}

/** generate_skill 工具实现 */
async function handleGenerateSkill(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sources = args.sources as string[];
  if (!sources || !Array.isArray(sources) || sources.length === 0) {
    throw new Error('sources 参数必须是非空数组');
  }

  const agentType = (args.agentType as AgentType) || 'codex';
  const skillName = args.name as string | undefined;
  const template = args.template as string | undefined;
  const force = args.force as boolean;
  const dryRun = args.dryRun as boolean;

  // LLM 配置：优先用参数传入的，回退到环境变量
  const model =
    (args.model as string) || process.env.DOC2SKILL_MODEL || 'deepseek-chat';
  const apiKey =
    (args.apiKey as string) ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const baseURL =
    (args.baseUrl as string) || process.env.DOC2SKILL_BASE_URL || undefined;
  const localModelName = args.localModelName as string | undefined;

  if (!isLocalModel(model) && !apiKey) {
    throw new Error(
      '缺少 API Key。请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量。',
    );
  }

  const llmConfig = resolveModel(model, {
    apiKey,
    baseUrl: baseURL,
    localModelName,
  });

  const result: SkillResult = await runPipeline(sources, {
    agentType,
    llm: llmConfig,
    name: skillName,
    template,
    force: force ?? false,
    dryRun: dryRun ?? false,
    stdout: false,
    outputMode: 'modern',
  });

  return {
    success: true,
    agentType: result.agentType,
    content: result.content,
    suggestedPath: result.suggestedPath,
    artifacts: result.artifacts?.map((a) => ({
      path: a.path,
      kind: a.kind,
      size: a.content.length,
    })),
    stats: result.stats,
    quality: result.quality
      ? {
          score: result.quality.score,
          passed: result.quality.passed,
        }
      : undefined,
  };
}

/** scan_directory 工具实现 */
async function handleScanDirectory(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { scanDirectory } = await import('./loader/directory.js');
  const dirPath = args.directory as string;
  if (!dirPath) throw new Error('directory 参数必填');

  const maxDepth = (args.maxDepth as number) ?? 5;
  const files = await scanDirectory(dirPath, { maxDepth });

  return {
    directory: dirPath,
    fileCount: files.length,
    files,
  };
}

/** MCP 模式下日志全部走 stderr */
function setLogToStderrForMcp(): void {
  // logger 模块内部已经默认写 stderr，这里确保 verbose 不输出到 stdout
  process.env.DOC2SKILL_MCP = '1';
}
