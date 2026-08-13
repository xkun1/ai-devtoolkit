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
import { exportEnv, importEnv } from './env/index.js';
import {
  MODEL_PRESETS,
  isLocalModel,
  resolveModel,
  resolveLocalModelName,
} from './models.js';
import { setVerbose, setLogToStderr, error, info } from './utils/logger.js';
import { isValidTemplate, listTemplates } from './templates/index.js';
import type { AgentType, OutputMode } from './types/index.js';

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
  noExplain?: boolean;
  envExport?: boolean;
  envImport?: string;
  execute?: boolean;
}

const PACKAGE_VERSION = readPackageVersion();

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
    .description('🛠️ 开发者工具箱：AI 技能包生成 · 代码搜索 · 环境迁移')
    .version(PACKAGE_VERSION)
    .argument(
      '[sources...]',
      '文档来源：URL 或本地文件路径（可多个，将合并为一个技能包）。无参数时进入交互式向导。',
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
    // ── 代码搜索模式 ──
    .option(
      '--scan-code',
      '扫描当前项目代码并构建搜索索引（之后可用 --search 或交互式搜索）',
    )
    .option('--search <query>', '用自然语言搜索项目代码')
    .option('--no-explain', '搜索结果不使用 LLM 解释（仅显示匹配的代码片段）')
    // ── 环境迁移 ──
    .option(
      '--env-export',
      '导出当前开发环境配置（Homebrew/npm/pip/SDK/VSCode 等），生成快照和安装脚本',
    )
    .option(
      '--env-import <file>',
      '从环境快照 JSON 恢复（dry-run 预览，加 --execute 执行安装）',
    )
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

  // ── 代码搜索模式 ──
  if (options.scanCode || options.search !== undefined) {
    const searchRoot = sources.length > 0 ? resolve(sources[0]) : process.cwd();

    // 解析 LLM 配置（用于智能解释）
    const localModelName = resolveLocalModelName(model, options.localModel);
    let llmConfig: ReturnType<typeof resolveModel> | undefined;
    try {
      llmConfig = resolveModel(model, { apiKey, baseUrl, localModelName });
      if (!isLocalModel(model) && !llmConfig.apiKey) {
        llmConfig = undefined; // 无 API Key 时退化为纯文本模式
      }
    } catch {
      llmConfig = undefined;
    }

    const useExplain = !options.noExplain && !!llmConfig;

    // --search <query>：单次搜索
    if (options.search !== undefined) {
      const query = options.search;
      if (!query.trim()) {
        throw new Error('搜索内容不能为空');
      }
      // 如果同时指定了 --scan-code，先扫描再搜索
      if (options.scanCode) {
        info('╔══════════════════════════════════════╗');
        info('║   🔍 devtoolkit — 代码搜索             ║');
        info('╚══════════════════════════════════════╝');
        info('');
        await initCodeIndex({ root: searchRoot });
        info(`🔎 搜索: "${query}"`);
        await searchAndPrint(query, llmConfig, useExplain, searchRoot);
      } else {
        info('╔══════════════════════════════════════╗');
        info('║   🔍 devtoolkit — 代码搜索             ║');
        info('╚══════════════════════════════════════╝');
        info('');
        info(`🔎 搜索: "${query}"`);
        await searchAndPrint(query, llmConfig, useExplain, searchRoot);
      }
      return;
    }

    // --scan-code：扫描初始化后进入交互式搜索
    if (options.scanCode) {
      info('╔══════════════════════════════════════╗');
      info('║   🔍 devtoolkit — 代码搜索             ║');
      info('╚══════════════════════════════════════╝');
      await startSearchSession(llmConfig, useExplain, searchRoot);
      return;
    }
  }

  // ── 环境迁移 ──
  if (options.envExport || options.envImport) {
    setVerbose(options.verbose || false);

    if (options.envExport) {
      const outputDir =
        sources.length > 0 ? resolve(sources[0]) : process.cwd();
      await exportEnv({ outputDir });
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
    });
    server.once(
      'listening',
      () => void openBrowser(`http://127.0.0.1:${port}`),
    );
    return;
  }

  if (options.mcp) {
    startMcpServer({
      model,
      baseURL: baseUrl,
      apiKey,
      localModelName: options.localModel,
    });
    return; // MCP 模式阻塞运行，不会走到这里
  }

  const agentTypeRaw = options.type || cfg.type || 'codex';
  const outputPath = options.out || cfg.out;
  const skillName = options.name || cfg.name;
  const templateId = options.template || cfg.template;
  const verbose = options.verbose || cfg.verbose || false;
  const outputMode: OutputMode =
    options.legacy || cfg.outputMode === 'legacy' ? 'legacy' : 'modern';

  setVerbose(verbose);
  setLogToStderr(options.stdout === true);

  if (!sources?.length) {
    await runInteractiveWizard();
    return;
  }

  if (!isValidAgentType(agentTypeRaw)) {
    throw new Error(
      `无效的 Agent 类型: ${agentTypeRaw}（可选: codex, cursor, claude）`,
    );
  }
  if (templateId && !isValidTemplate(templateId)) {
    throw new Error(
      `未知模板: ${templateId}。请使用 --list-templates 查看可用值`,
    );
  }
  if (options.localModel && !isLocalModel(model)) {
    throw new Error('--local-model 只能与本地模型一起使用');
  }

  const localModelName = resolveLocalModelName(model, options.localModel);
  if (isLocalModel(model) && !localModelName) {
    const envHint =
      model === 'ollama-local'
        ? 'OLLAMA_MODEL'
        : model === 'lmstudio-local'
          ? 'LMSTUDIO_MODEL'
          : 'LOCAL_MODEL_NAME';
    throw new Error(
      `缺少本地模型名。请使用 --local-model <name> 或设置 ${envHint}`,
    );
  }
  if (model === 'custom-local' && !baseUrl) {
    throw new Error('custom-local 必须通过 --base-url 指定本地服务地址');
  }

  const llmConfig = resolveModel(model, { apiKey, baseUrl, localModelName });
  if (!isLocalModel(model) && !llmConfig.apiKey) {
    const envVar = MODEL_PRESETS[model]?.envVar || 'OPENAI_API_KEY';
    throw new Error(`缺少 API Key。请设置 ${envVar}，或通过 --api-key 指定`);
  }

  const agentType = agentTypeRaw as AgentType;
  const pipelineOptions = {
    agentType,
    outputPath,
    llm: llmConfig,
    verbose,
    name: skillName,
    stdout: options.stdout || false,
    dryRun: options.dryRun || false,
    force: options.force || false,
    crawl: options.crawl || false,
    crawlDepth: options.crawlDepth,
    crawlPages: options.crawlPages,
    template: templateId,
    incremental: options.update || false,
    outputMode,
    mergeDir: options.merge || false,
    dirMaxDepth: options.dirDepth,
  };

  if (options.watch) {
    startWatch(sources, {
      ...pipelineOptions,
      stdout: false,
      dryRun: false,
      force: true,
    });
    return;
  }

  if (!options.stdout && !options.dryRun) {
    info('╔══════════════════════════════════════╗');
    info('║   🚀 devtoolkit — 文档转技能包        ║');
    info('╚══════════════════════════════════════╝');
    info('');
  }

  await runPipeline(sources, pipelineOptions);
}

async function runInteractiveWizard(): Promise<void> {
  try {
    const wizardResult = await runWizard();
    if (!wizardResult) return;
    await runPipeline(wizardResult.sources, {
      agentType: wizardResult.agentType,
      outputPath: wizardResult.outputPath,
      llm: wizardResult.llm,
      name: wizardResult.name,
      stdout: false,
      dryRun: false,
      force: false,
      outputMode: 'modern',
    });
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
    // 自动打开失败不影响服务运行。
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
  try {
    await createProgram().parseAsync(argv);
  } catch (err: unknown) {
    error(`\n❌ 执行失败: ${getErrorMessage(err)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void runCli(process.argv);
}
