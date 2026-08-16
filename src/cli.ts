import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { runPipeline } from './pipeline.js';
import { isValidAgentType } from './format/index.js';
import { runWizard } from './wizard.js';
import { loadConfig } from './config.js';
import { startWatch } from './watcher.js';
import { startServer } from './server.js';
import { startMcpServer } from './mcp-server.js';
import {
  initCodeIndex,
  searchAndPrint,
  startSearchSession,
} from './search/index.js';
import { exportEnv, importEnv, diffEnv } from './env/index.js';
import { convertFile, syncRules } from './convert/index.js';
import { evalSkillFile } from './eval/index.js';
import { printProjectGraph, printImpactAnalysis } from './graph/index.js';
import { isLocalModel, resolveModel, resolveLocalModelName } from './models.js';
import { setVerbose, setLogToStderr, error, info } from './utils/logger.js';
import { isValidTemplate, listTemplates } from './templates/index.js';
import type {
  AgentType,
  LLMConfig,
  OutputMode,
  PipelineOptions,
} from './types/index.js';

interface CliOptions {
  type?: string;
  out?: string;
  model?: string;
  name?: string;
  stdout?: boolean;
  dryRun?: boolean;
  force?: boolean;
  crawl?: boolean;
  crawlDepth?: number;
  crawlPages?: number;
  watch?: boolean;
  ui?: boolean;
  port?: number;
  baseUrl?: string;
  apiKey?: string;
  localModel?: string;
  verbose?: boolean;
  template?: string;
  listTemplates?: boolean;
  update?: boolean;
  legacy?: boolean;
  mcp?: boolean;
  merge?: boolean;
  dirDepth?: number;
  scanCode?: boolean;
  search?: string;
  explain?: boolean;
  envExport?: boolean;
  envImport?: string;
  envDiff?: string;
  execute?: boolean;
  convert?: string;
  to?: string;
  sync?: boolean;
  syncFrom?: string;
  syncTo?: string;
  eval?: string;
  graph?: boolean;
  impact?: string;
  llmTimeout?: number;
  maxOutputTokens?: number;
  batchConcurrency?: number;
  maxBatchFiles?: number;
  evalConcurrency?: number;
  evalMaxCases?: number;
  cache?: boolean;
  searchMode?: 'hybrid' | 'exact' | 'semantic';
}

const PACKAGE_VERSION = readPackageVersion();
let cliAbortSignal: AbortSignal | undefined;

function parseInteger(
  value: string,
  label: string,
  min: number,
  max: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(`${label} 必须是整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidArgumentError(`${label} 必须在 ${min}-${max} 之间`);
  }
  return parsed;
}

export function createProgram(): Command {
  const program = new Command();

  program
    .name('devtoolkit')
    .description(
      '🛠️ 开发者工具箱：AI 技能包生成 · 规则互转 · 技能评测 · 代码搜索与影响面分析 · 环境迁移',
    )
    .version(PACKAGE_VERSION)
    .argument(
      '[sources...]',
      '文档来源：URL 或本地文件路径（可多个）。无参数时进入交互式向导。',
    )
    .option('-t, --type <type>', '目标 Agent 类型 (codex, cursor, claude)')
    .option('-o, --out <path>', '输出文件路径')
    .option('-m, --model <model>', 'LLM 模型名')
    .option('-n, --name <name>', '自定义技能名（Codex frontmatter）')
    .option('--stdout', '输出到标准输出而不写文件')
    .option('--dry-run', '预览生成结果，不写入文件')
    .option('--force', '强制覆盖已存在的输出文件')
    .option('--crawl', '爬取模式：自动发现文档站点子页面')
    .option('--crawl-depth <n>', '爬取最大深度（0-10，默认 2）', (value) =>
      parseInteger(value, 'crawl-depth', 0, 10),
    )
    .option('--crawl-pages <n>', '爬取最大页面数（1-500，默认 10）', (value) =>
      parseInteger(value, 'crawl-pages', 1, 500),
    )
    .option('-w, --watch', '监控本地源文件，变更后自动重新生成')
    .option('--ui', '启动 Web UI 界面（仅监听本机）')
    .option('--port <n>', 'Web UI 端口号（1-65535，默认 3456）', (value) =>
      parseInteger(value, 'port', 1, 65535),
    )
    .option('--base-url <url>', 'LLM API Base URL（覆盖预设）')
    .option('--api-key <key>', 'API Key（建议用环境变量）')
    .option('--local-model <name>', '本地服务中的真实模型名')
    .option(
      '--llm-timeout <ms>',
      '单次 LLM 调用超时（1000-600000ms）',
      (value) => parseInteger(value, 'llm-timeout', 1000, 600000),
    )
    .option(
      '--max-output-tokens <n>',
      '单次模型响应 Token 上限（1-131072）',
      (value) => parseInteger(value, 'max-output-tokens', 1, 131072),
    )
    .option(
      '--batch-concurrency <n>',
      '目录批处理并发数（1-8，默认 2）',
      (value) => parseInteger(value, 'batch-concurrency', 1, 8),
    )
    .option(
      '--max-batch-files <n>',
      '目录批处理文件数上限（1-10000，默认 100）',
      (value) => parseInteger(value, 'max-batch-files', 1, 10000),
    )
    .option('-v, --verbose', '显示详细日志')
    .option('--template <id>', '使用预设模板')
    .option('--list-templates', '列出所有可用模板')
    .option('--update', '增量更新：跳过未变更的文档')
    .option('--legacy', '输出旧版单文件（默认使用各 Agent 当前推荐目录结构）')
    .option('--mcp', '启动 MCP Server（stdio JSON-RPC，供 AI Agent 直接调用）')
    .option('--merge', '目录模式下合并所有文件为一个技能包')
    .option(
      '--dir-depth <n>',
      '目录扫描最大递归深度（1-20，默认 5）',
      (value) => parseInteger(value, 'dir-depth', 1, 20),
    )
    // ── 规则互转与同步 ──
    .option(
      '--convert <file>',
      '转换指定的规则文件（结合 -t/--type 指定目标 Agent）',
    )
    .option('--sync', '自动发现并同步项目中的全部 Agent 规则')
    .option('--sync-from <agent>', '同步源 Agent（默认自动检测）')
    .option(
      '--sync-to <agents>',
      '同步目标 Agent（多个用逗号隔开，如 cursor,claude）',
    )
    // ── 技能效果评测 (Skill Eval) ──
    .option(
      '--eval <skillFile>',
      '自动生成测试集并对指定技能包进行效果与命中度对照评测',
    )
    .option(
      '--eval-concurrency <n>',
      '技能评测并发数（1-4，默认 2）',
      (value) => parseInteger(value, 'eval-concurrency', 1, 4),
    )
    .option(
      '--eval-max-cases <n>',
      '技能评测用例上限（1-20，默认 20）',
      (value) => parseInteger(value, 'eval-max-cases', 1, 20),
    )
    // ── 代码搜索与依赖分析 ──
    .option(
      '--scan-code',
      '扫描当前项目代码并构建搜索索引（之后可用 --search 或交互式搜索）',
    )
    .option('--search <query>', '用自然语言搜索项目代码')
    .option('--no-explain', '搜索结果不使用 LLM 解释（仅显示匹配的代码片段）')
    .option('--graph', '分析当前项目的代码依赖关系并生成 Mermaid 架构拓扑图')
    .option('--no-cache', '禁用依赖图谱增量分析缓存，执行全量静态分析')
    .option(
      '--search-mode <mode>',
      '代码搜索模式: hybrid (默认) | exact | semantic',
    )
    .option(
      '--impact <file>',
      '分析修改指定文件所波及的所有直接与间接上游依赖链路',
    )
    // ── 环境迁移 ──
    .option(
      '--env-export',
      '导出当前开发环境配置（Homebrew/npm/pip/SDK/VSCode 等），生成快照和安装脚本',
    )
    .option(
      '--env-import <file>',
      '从环境快照 JSON 恢复（dry-run 预览，加 --execute 执行安装）',
    )
    .option('--env-diff <file>', '比对当前机器与指定环境快照 JSON 的差异')
    .option(
      '--execute',
      '配合 --env-import 使用：实际执行安装命令（不加则只预览）',
    )
    .action(runCommand);

  return program;
}

async function runCommand(
  sources: string[],
  options: CliOptions,
): Promise<void> {
  if (options.listTemplates) {
    printTemplates();
    return;
  }

  const cfg = await loadConfig();
  const model = options.model || cfg.model || 'deepseek-chat';
  const baseUrl = options.baseUrl || cfg.baseUrl;
  const apiKey = options.apiKey || cfg.apiKey;
  const llmTimeoutMs = options.llmTimeout ?? cfg.llmTimeoutMs;
  const maxOutputTokens = options.maxOutputTokens ?? cfg.maxOutputTokens;
  const batchConcurrency = options.batchConcurrency ?? cfg.batchConcurrency;
  const maxBatchFiles = options.maxBatchFiles ?? cfg.maxBatchFiles;
  setVerbose(options.verbose ?? cfg.verbose ?? false);

  // ── 技能效果评测 ──
  if (options.eval) {
    const localModelName = resolveLocalModelName(model, options.localModel);
    const llm = {
      ...resolveModel(model, { apiKey, baseUrl, localModelName }),
      maxOutputTokens,
    };
    await evalSkillFile(options.eval, {
      llm,
      outputDir: options.out,
      concurrency: options.evalConcurrency,
      maxCases: options.evalMaxCases,
      timeoutMs: llmTimeoutMs,
      signal: cliAbortSignal,
    });
    return;
  }

  // ── 代码架构依赖图谱与影响面分析 ──
  if (options.graph) {
    const root = sources.length > 0 ? resolve(sources[0]) : process.cwd();
    await printProjectGraph({ root, useCache: options.cache !== false });
    return;
  }

  if (options.impact) {
    const root = sources.length > 0 ? resolve(sources[0]) : process.cwd();
    await printImpactAnalysis(options.impact, { root });
    return;
  }

  // ── 规则单文件转换 ──
  if (options.convert) {
    const targetAgent = (options.type as AgentType) || 'codex';
    if (!isValidAgentType(targetAgent)) {
      throw new Error(`无效的目标 Agent: ${targetAgent}`);
    }
    await convertFile(options.convert, targetAgent, {
      name: options.name,
      outputDir: options.out,
    });
    return;
  }

  // ── 规则全量同步 ──
  if (options.sync) {
    const projectRoot =
      sources.length > 0 ? resolve(sources[0]) : process.cwd();
    const fromAgent = options.syncFrom || 'auto';
    if (!['auto', 'codex', 'cursor', 'claude'].includes(fromAgent)) {
      throw new Error(`无效的同步源 Agent: ${fromAgent}`);
    }
    const toAgents = options.syncTo
      ? options.syncTo.split(',').map((value) => value.trim())
      : undefined;
    if (toAgents?.some((agent) => !isValidAgentType(agent))) {
      throw new Error(`无效的同步目标 Agent: ${options.syncTo}`);
    }
    await syncRules({
      projectRoot,
      from: fromAgent as AgentType | 'auto',
      to: toAgents as AgentType[] | undefined,
      dryRun: options.dryRun || false,
    });
    return;
  }

  // ── 代码搜索模式 ──
  if (options.scanCode || options.search !== undefined) {
    const searchRoot = sources.length > 0 ? resolve(sources[0]) : process.cwd();

    const localModelName = resolveLocalModelName(model, options.localModel);
    let llmConfig: LLMConfig | undefined;
    try {
      llmConfig = {
        ...resolveModel(model, { apiKey, baseUrl, localModelName }),
        maxOutputTokens,
      };
      if (!isLocalModel(model) && !llmConfig.apiKey) {
        llmConfig = undefined;
      }
    } catch {
      llmConfig = undefined;
    }

    const useExplain = options.explain !== false && !!llmConfig;

    if (options.search !== undefined) {
      const query = options.search;
      if (!query.trim()) {
        throw new Error('搜索内容不能为空');
      }
      info('╔══════════════════════════════════════╗');
      info('║   🔍 devtoolkit — 代码搜索             ║');
      info('╚══════════════════════════════════════╝');
      info('');
      if (options.scanCode) {
        await initCodeIndex({ root: searchRoot });
      }
      info(`🔎 搜索: "${query}"`);
      if (cliAbortSignal || llmTimeoutMs !== undefined) {
        await searchAndPrint(
          query,
          llmConfig,
          useExplain,
          searchRoot,
          undefined,
          {
            signal: cliAbortSignal,
            llmTimeoutMs,
          },
        );
      } else {
        await searchAndPrint(query, llmConfig, useExplain, searchRoot);
      }
      return;
    }

    if (options.scanCode) {
      info('╔══════════════════════════════════════╗');
      info('║   🔍 devtoolkit — 代码搜索             ║');
      info('╚══════════════════════════════════════╝');
      await startSearchSession(llmConfig, useExplain, searchRoot, {
        signal: cliAbortSignal,
        llmTimeoutMs,
      });
      return;
    }
  }

  // ── 环境迁移 ──
  if (options.envExport || options.envImport || options.envDiff) {
    if (options.envExport) {
      const outputDir =
        sources.length > 0 ? resolve(sources[0]) : process.cwd();
      await exportEnv({ outputDir });
      return;
    }

    if (options.envDiff) {
      await diffEnv(options.envDiff);
      return;
    }

    if (options.envImport) {
      await importEnv(options.envImport, { execute: options.execute || false });
      return;
    }
  }

  if (options.ui) {
    if (options.localModel && !isLocalModel(model)) {
      throw new Error('--local-model 只能与本地模型一起使用');
    }
    const port = options.port ?? 3456;
    const server = startServer({
      port,
      apiKey:
        apiKey ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.OPENAI_API_KEY ||
        '',
      baseURL: baseUrl,
      model,
      llmTimeoutMs,
      maxOutputTokens,
    });
    server.once(
      'listening',
      () => void openBrowser(`http://127.0.0.1:${port}`),
    );
    return;
  }

  if (options.mcp) {
    if (model === 'custom-local') {
      const localName = resolveLocalModelName(model, options.localModel);
      if (!localName) {
        throw new Error(
          '使用 custom-local 时缺少本地模型名，请通过 --local-model 指定',
        );
      }
      if (!baseUrl) {
        throw new Error('使用 custom-local 时必须通过 --base-url 指定服务地址');
      }
    }
    startMcpServer({
      model,
      baseURL: baseUrl,
      apiKey,
      localModelName: options.localModel,
      llmTimeoutMs,
      maxOutputTokens,
    });
    return;
  }

  if (sources.length === 0) {
    await handleWizardFlow(model, apiKey, baseUrl, {
      ...options,
      llmTimeout: llmTimeoutMs,
      maxOutputTokens,
      batchConcurrency,
      maxBatchFiles,
    });
    return;
  }

  if (options.stdout) {
    setLogToStderr(true);
  }

  if (model === 'custom-local') {
    const name = resolveLocalModelName(model, options.localModel);
    if (!name) {
      throw new Error(
        '使用 custom-local 时缺少本地模型名，请通过 --local-model 指定',
      );
    }
    if (!baseUrl) {
      throw new Error('使用 custom-local 时必须通过 --base-url 指定服务地址');
    }
  }

  const localModelName = resolveLocalModelName(model, options.localModel);
  const llm = {
    ...resolveModel(model, {
      apiKey,
      baseUrl,
      localModelName,
    }),
    maxOutputTokens,
  };

  const agentType: AgentType =
    (options.type as AgentType) || cfg.type || 'codex';
  if (!isValidAgentType(agentType)) {
    throw new Error(
      `无效的 Agent 类型: "${agentType}"，支持: codex, cursor, claude`,
    );
  }

  const template = options.template ?? cfg.template;
  if (template && !isValidTemplate(template)) {
    throw new Error(
      `未知模板: "${template}"。使用 --list-templates 查看可用模板`,
    );
  }

  const outputMode: OutputMode = options.legacy
    ? 'legacy'
    : (cfg.outputMode ?? 'modern');

  // 显式约束类型，防止 CLI 字段名漂移后被结构化类型静默忽略。
  const pipelineOptions: PipelineOptions = {
    agentType,
    outputPath: options.out ?? cfg.out,
    llm,
    name: options.name ?? cfg.name,
    stdout: options.stdout,
    dryRun: options.dryRun,
    force: options.force,
    crawl: options.crawl,
    crawlDepth: options.crawlDepth,
    crawlPages: options.crawlPages,
    template,
    incremental: options.update,
    outputMode,
    mergeDir: options.merge,
    dirMaxDepth: options.dirDepth,
    signal: cliAbortSignal,
    llmTimeoutMs,
    batchConcurrency,
    maxBatchFiles,
  };

  if (options.watch) {
    startWatch(sources, pipelineOptions);
    return;
  }

  await runPipeline(sources, pipelineOptions);
}

async function handleWizardFlow(
  model: string,
  apiKey: string | undefined,
  baseUrl: string | undefined,
  options: CliOptions,
): Promise<void> {
  try {
    const wizardAction = await runWizard();
    if (!wizardAction) return;

    if (wizardAction.mode === 'skill') {
      const data = wizardAction.data;
      await runPipeline(data.sources, {
        agentType: data.agentType,
        outputPath: data.outputPath,
        llm: {
          ...data.llm,
          maxOutputTokens: options.maxOutputTokens ?? data.llm.maxOutputTokens,
        },
        name: data.name,
        stdout: false,
        dryRun: false,
        force: false,
        outputMode: 'modern',
        signal: cliAbortSignal,
        llmTimeoutMs: options.llmTimeout,
        batchConcurrency: options.batchConcurrency,
        maxBatchFiles: options.maxBatchFiles,
      });
      return;
    }

    if (wizardAction.mode === 'convert') {
      await convertFile(wizardAction.file, wizardAction.to);
      return;
    }

    if (wizardAction.mode === 'sync') {
      await syncRules({
        projectRoot: wizardAction.projectRoot,
        from: wizardAction.from,
        to: wizardAction.to,
        dryRun: wizardAction.dryRun,
      });
      return;
    }

    if (wizardAction.mode === 'search') {
      const localModelName = resolveLocalModelName(model, options.localModel);
      let llmConfig: LLMConfig | undefined;
      try {
        llmConfig = {
          ...resolveModel(model, { apiKey, baseUrl, localModelName }),
          maxOutputTokens: options.maxOutputTokens,
        };
      } catch {
        llmConfig = undefined;
      }
      if (wizardAction.interactive) {
        await startSearchSession(
          llmConfig,
          options.explain !== false && !!llmConfig,
          wizardAction.projectRoot,
          {
            signal: cliAbortSignal,
            llmTimeoutMs: options.llmTimeout,
          },
        );
      } else if (wizardAction.query) {
        await searchAndPrint(
          wizardAction.query,
          llmConfig,
          options.explain !== false && !!llmConfig,
          wizardAction.projectRoot,
          undefined,
          {
            signal: cliAbortSignal,
            llmTimeoutMs: options.llmTimeout,
          },
        );
      }
      return;
    }

    if (wizardAction.mode === 'env') {
      if (wizardAction.subAction === 'export') {
        await exportEnv();
      } else if (wizardAction.subAction === 'diff' && wizardAction.file) {
        await diffEnv(wizardAction.file);
      } else if (wizardAction.subAction === 'import' && wizardAction.file) {
        await importEnv(wizardAction.file, {
          execute: wizardAction.execute || false,
        });
      }
      return;
    }

    if (wizardAction.mode === 'ui') {
      const port = wizardAction.port ?? 3456;
      const server = startServer({
        port,
        apiKey:
          apiKey ||
          process.env.DEEPSEEK_API_KEY ||
          process.env.OPENAI_API_KEY ||
          '',
        baseURL: baseUrl,
        model,
        llmTimeoutMs: options.llmTimeout,
        maxOutputTokens: options.maxOutputTokens,
      });
      server.once(
        'listening',
        () => void openBrowser(`http://127.0.0.1:${port}`),
      );
      return;
    }
  } catch (err: unknown) {
    if (getErrorName(err) === 'ExitPromptError') {
      info('\n  已退出');
      return;
    }
    throw err;
  }
}

function printTemplates(): void {
  info('');
  info('  📋 内置模板列表');
  info('  ─────────────────────────────────');
  for (const template of listTemplates()) {
    const agents = template.agents.length ? template.agents.join('/') : '全部';
    info(`  🏷️  ${template.id.padEnd(16)} ${template.name}`);
    info(`     ${template.description}`);
    info(`     适合: ${agents}`);
    info('');
  }
}

async function openBrowser(url: string): Promise<void> {
  try {
    const { spawn } = await import('node:child_process');
    const command =
      process.platform === 'darwin'
        ? 'open'
        : process.platform === 'win32'
          ? 'cmd'
          : 'xdg-open';
    const args =
      process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // 自动打开失败不影响服务运行
  }
}

function readPackageVersion(): string {
  const packagePath = join(__dirname, '..', 'package.json');
  const raw = readFileSync(packagePath, 'utf-8');
  const parsed = JSON.parse(raw) as { version?: unknown };
  return typeof parsed.version === 'string' ? parsed.version : '0.0.0';
}

function getErrorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const controller = new AbortController();
  const onSigint = () => controller.abort(new Error('用户取消了操作'));
  process.once('SIGINT', onSigint);
  cliAbortSignal = controller.signal;
  try {
    await createProgram().parseAsync(argv);
  } catch (err: unknown) {
    error(`\n❌ 执行失败: ${getErrorMessage(err)}`);
    process.exitCode = 1;
  } finally {
    cliAbortSignal = undefined;
    process.removeListener('SIGINT', onSigint);
  }
}

if (require.main === module) {
  void runCli(process.argv);
}
