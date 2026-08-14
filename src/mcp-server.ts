/**
 * MCP (Model Context Protocol) Server — stdio 模式
 *
 * 让 devtoolkit 作为 AI Agent 的原生工具使用。
 * AI Agent 通过 MCP 协议调用 `generate_skill`、`search_code`、`convert_rule`、`sync_rules` 等工具。
 *
 * 用法:
 *   devtoolkit --mcp
 *
 * Claude Desktop / Cursor 等 MCP 客户端配置示例:
 *   {
 *     "mcpServers": {
 *       "devtoolkit": {
 *         "command": "npx",
 *         "args": ["devtoolkit", "--mcp"]
 *       }
 *     }
 *   }
 */
import { createInterface } from 'node:readline';
import type { AgentType, SkillResult } from './types/index.js';
import { runPipeline } from './pipeline.js';
import { resolveModel, isLocalModel } from './models.js';
import { info } from './utils/logger.js';
import {
  initCodeIndex,
  searchProjectCode,
  explainResults,
} from './search/index.js';
import {
  exportEnvironment,
  diffEnvironment,
  loadSnapshot,
  formatDiffPreview,
} from './env/index.js';
import {
  convertFile,
  convertRule,
  parseRule,
  syncProjectRules,
} from './convert/index.js';

export interface McpServerOptions {
  model?: string;
  baseURL?: string;
  apiKey?: string;
  localModelName?: string;
}

let serverDefaults: McpServerOptions = {};

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
  name: 'devtoolkit',
  version: '0.7.0',
};

const CAPABILITIES = {
  tools: {},
};

/** generate_skill 工具的 JSON Schema */
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
      description: '预设模板 ID（如 api-reference / best-practices）',
    },
    model: {
      type: 'string',
      description: 'LLM 模型名（默认 deepseek-chat）',
    },
    baseUrl: {
      type: 'string',
      description: 'LLM API Base URL',
    },
    apiKey: {
      type: 'string',
      description: 'API Key',
    },
    localModelName: {
      type: 'string',
      description: '本地模型真实名称',
    },
    outputPath: {
      type: 'string',
      description: '输出文件路径',
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

/** scan_directory 工具的 JSON Schema */
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

/** scan_code 工具的 JSON Schema */
const SCAN_CODE_SCHEMA = {
  type: 'object' as const,
  properties: {
    directory: {
      type: 'string',
      description: '项目根目录路径（默认当前工作目录）',
    },
  },
  required: [] as const,
};

/** search_code 工具的 JSON Schema */
const SEARCH_CODE_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description:
        '搜索查询：自然语言关键词、函数名、类名、path:src 等过滤语法',
    },
    directory: {
      type: 'string',
      description: '项目根目录路径（默认当前工作目录）',
    },
    limit: {
      type: 'number',
      description: '返回结果数量上限（默认 10）',
    },
    explain: {
      type: 'boolean',
      description: '是否使用 LLM 解释搜索结果（默认 true）',
    },
  },
  required: ['query'],
};

/** convert_rule 工具的 JSON Schema */
const CONVERT_RULE_SCHEMA = {
  type: 'object' as const,
  properties: {
    ruleContent: {
      type: 'string',
      description:
        '规则原始 Markdown 或带 Frontmatter 的内容（与 rulePath 二选一）',
    },
    rulePath: {
      type: 'string',
      description: '本地规则文件路径（如 .cursor/rules/api.mdc 或 SKILL.md）',
    },
    to: {
      type: 'string',
      enum: ['cursor', 'codex', 'claude'],
      description: '转换目标 Agent 类型',
    },
    name: {
      type: 'string',
      description: '自定义规则名称',
    },
    write: {
      type: 'boolean',
      description: '是否直接写入目标路径（默认 false 只返回预览）',
    },
  },
  required: ['to'],
};

/** sync_rules 工具的 JSON Schema */
const SYNC_RULES_SCHEMA = {
  type: 'object' as const,
  properties: {
    projectRoot: {
      type: 'string',
      description: '项目根目录路径（默认当前工作目录）',
    },
    from: {
      type: 'string',
      enum: ['cursor', 'codex', 'claude', 'auto'],
      description: '同步源 Agent 规则（默认 auto 自动检测）',
    },
    to: {
      type: 'array',
      items: { type: 'string', enum: ['cursor', 'codex', 'claude'] },
      description: '同步目标 Agent 列表（默认同步到其他未配置的全部 Agent）',
    },
    dryRun: {
      type: 'boolean',
      description: '是否为 dry-run 预览模式（默认 true 不写入文件）',
    },
  },
  required: [] as const,
};

/** export_env 工具的 JSON Schema */
const EXPORT_ENV_SCHEMA = {
  type: 'object' as const,
  properties: {
    outputDir: {
      type: 'string',
      description: '快照与脚本保存目录（默认当前目录）',
    },
    outputPrefix: {
      type: 'string',
      description: '输出文件名前缀（默认 devtoolkit-env）',
    },
  },
  required: [] as const,
};

/** diff_env 工具的 JSON Schema */
const DIFF_ENV_SCHEMA = {
  type: 'object' as const,
  properties: {
    snapshotPath: {
      type: 'string',
      description: '环境快照 JSON 文件路径',
    },
  },
  required: ['snapshotPath'],
};

/** 注册给 MCP Client 的工具列表 */
const TOOLS = [
  {
    name: 'generate_skill',
    description:
      '将给定的文档 URL 或本地文件转化为 AI Agent（Codex/Cursor/Claude）的高质量技能包 / 规则文件。',
    inputSchema: GENERATE_SKILL_SCHEMA,
  },
  {
    name: 'scan_directory',
    description:
      '扫描指定目录下的所有可转换文档文件（.md, .pdf, .docx, .html 等），返回文件列表。',
    inputSchema: SCAN_DIRECTORY_SCHEMA,
  },
  {
    name: 'scan_code',
    description: '扫描指定项目的代码文件，提取符号和构建本地倒排搜索索引。',
    inputSchema: SCAN_CODE_SCHEMA,
  },
  {
    name: 'search_code',
    description:
      '用自然语言搜索项目代码（基于 TF-IDF + 符号/路径多路召回），返回高相关代码片段及智能解释。',
    inputSchema: SEARCH_CODE_SCHEMA,
  },
  {
    name: 'convert_rule',
    description:
      '在 Cursor (.mdc)、Codex (SKILL.md)、Claude (CLAUDE.md) 之间双向无损互转规则。',
    inputSchema: CONVERT_RULE_SCHEMA,
  },
  {
    name: 'sync_rules',
    description:
      '自动扫描项目已存在的 Agent 规则，并一键同步分发到其他 Agent 平台（Cursor/Codex/Claude）。',
    inputSchema: SYNC_RULES_SCHEMA,
  },
  {
    name: 'export_env',
    description:
      '扫描当前开发环境（Homebrew / npm / pip / SDK / VSCode 等），生成环境快照 JSON 和一键恢复脚本。',
    inputSchema: EXPORT_ENV_SCHEMA,
  },
  {
    name: 'diff_env',
    description:
      '比对当前机器环境与指定环境快照 JSON 的差异（缺失包、多出包、版本不匹配）。',
    inputSchema: DIFF_ENV_SCHEMA,
  },
];

// ── MCP Server 核心逻辑 ──

export function startMcpServer(options: McpServerOptions = {}): void {
  serverDefaults = options;

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
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      void handleRequest(request);
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

  rl.on('close', () => {
    process.exit(0);
  });
}

function sendResponse(response: JsonRpcResponse): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

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

async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
): Promise<string | Record<string, unknown>> {
  switch (name) {
    case 'generate_skill':
      return await handleGenerateSkill(args);
    case 'scan_directory':
      return await handleScanDirectory(args);
    case 'scan_code':
      return await handleScanCode(args);
    case 'search_code':
      return await handleSearchCode(args);
    case 'convert_rule':
      return await handleConvertRule(args);
    case 'sync_rules':
      return await handleSyncRules(args);
    case 'export_env':
      return await handleExportEnv(args);
    case 'diff_env':
      return await handleDiffEnv(args);
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

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

  const model =
    (args.model as string) ||
    serverDefaults.model ||
    process.env.DOC2SKILL_MODEL ||
    'deepseek-chat';
  const apiKey =
    (args.apiKey as string) ||
    serverDefaults.apiKey ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const baseURL =
    (args.baseUrl as string) ||
    serverDefaults.baseURL ||
    process.env.DOC2SKILL_BASE_URL ||
    undefined;
  const localModelName =
    (args.localModelName as string) || serverDefaults.localModelName;

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

async function handleScanCode(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const directory = (args.directory as string) || process.cwd();
  const index = await initCodeIndex({ root: directory });

  return {
    success: true,
    directory,
    stats: index.stats,
  };
}

async function handleSearchCode(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const query = args.query as string;
  if (!query) throw new Error('query 参数必填');

  const directory = (args.directory as string) || process.cwd();
  const limit = (args.limit as number) ?? 10;
  const useExplain = (args.explain as boolean) ?? true;

  const { results, index } = await searchProjectCode(
    query,
    { limit },
    directory,
  );

  let explanation: string | undefined;
  if (useExplain && results.length > 0) {
    const model = serverDefaults.model || 'deepseek-chat';
    const apiKey =
      serverDefaults.apiKey ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';
    const baseURL = serverDefaults.baseURL;
    const localModelName = serverDefaults.localModelName;

    if (isLocalModel(model) || apiKey) {
      try {
        const llmConfig = resolveModel(model, {
          apiKey,
          baseUrl: baseURL,
          localModelName,
        });
        explanation = await explainResults({
          llm: llmConfig,
          query,
          results,
          projectRoot: index.projectRoot,
        });
      } catch {
        // ignore LLM failure
      }
    }
  }

  return {
    query,
    totalMatches: results.length,
    explanation,
    results: results.map((r) => ({
      file: r.chunk.file,
      language: r.chunk.language,
      lines: `${r.chunk.startLine}-${r.chunk.endLine}`,
      score: Number(r.score.toFixed(2)),
      matchedSymbols: r.matchedSymbols,
      matchedKeywords: r.matchedKeywords,
      codePreview: r.chunk.content.split('\n').slice(0, 20).join('\n'),
    })),
  };
}

async function handleConvertRule(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const toAgent = args.to as AgentType;
  const rulePath = args.rulePath as string | undefined;
  const ruleContent = args.ruleContent as string | undefined;
  const name = args.name as string | undefined;
  const shouldWrite = args.write === true;

  if (rulePath) {
    const res = await convertFile(rulePath, toAgent, {
      name,
      write: shouldWrite,
    });
    return {
      success: true,
      from: res.from,
      to: res.to,
      artifacts: res.artifacts,
    };
  }

  if (ruleContent) {
    const parsed = parseRule(ruleContent);
    const res = convertRule(parsed, { to: toAgent, name });
    return {
      success: true,
      from: res.from,
      to: res.to,
      artifacts: res.artifacts,
    };
  }

  throw new Error('必须提供 rulePath 或 ruleContent 参数');
}

async function handleSyncRules(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const projectRoot = (args.projectRoot as string) || process.cwd();
  const fromAgent = args.from as AgentType | 'auto' | undefined;
  const toAgents = args.to as AgentType[] | undefined;
  const dryRun = args.dryRun !== false;

  const res = await syncProjectRules({
    projectRoot,
    from: fromAgent,
    to: toAgents,
    dryRun,
  });

  return {
    success: true,
    dryRun,
    summary: res.summary,
    operations: res.operations,
  };
}

async function handleExportEnv(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const outputDir = (args.outputDir as string) || process.cwd();
  const outputPrefix = (args.outputPrefix as string) || 'devtoolkit-env';

  const res = await exportEnvironment({ outputDir, outputPrefix });
  return {
    success: true,
    jsonPath: res.jsonPath,
    scriptPath: res.scriptPath,
    summary: res.summary,
  };
}

async function handleDiffEnv(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshotPath = args.snapshotPath as string;
  if (!snapshotPath) throw new Error('snapshotPath 参数必填');

  const snapshot = loadSnapshot(snapshotPath);
  const diff = await diffEnvironment(snapshot);

  return {
    snapshotPath,
    hasDifferences: diff.hasDifferences,
    summary: diff.summary,
    preview: formatDiffPreview(diff),
    diff,
  };
}
