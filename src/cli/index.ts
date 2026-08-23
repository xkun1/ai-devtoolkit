import { resolve } from 'node:path';
import { Command } from 'commander';
import { runPipeline } from '../pipeline.js';
import { isValidAgentType } from '../format/index.js';
import { runWizard } from '../wizard.js';
import { loadConfig } from '../config.js';
import { startWatch } from '../watcher.js';
import { startServer } from '../server.js';
import { startMcpServer } from '../mcp-server.js';
import {
  initCodeIndex,
  searchAndPrint,
  startSearchSession,
} from '../search/index.js';
import { exportEnv, importEnv, diffEnv } from '../env/index.js';
import { convertFile, syncRules } from '../convert/index.js';
import { evalSkillFile } from '../eval/index.js';
import { printProjectGraph, printImpactAnalysis } from '../graph/index.js';
import {
  isLocalModel,
  resolveModel,
  resolveLocalModelName,
} from '../models.js';
import {
  setVerbose,
  setLogToStderr,
  error,
  info,
  success,
} from '../utils/logger.js';
import { isValidTemplate, listTemplates } from '../templates/index.js';
import {
  runDoctor,
  printDoctorReport,
  listSkills,
  removeSkill,
} from '../index.js';
import { generateRepoMap } from '../repomap/index.js';
import { generateRefreshWorkflow } from '../refresh/index.js';
import { AGENT_TYPE_HELP, isAgentType } from '../agents.js';
import { PACKAGE_VERSION } from '../version.js';
import type {
  AgentType,
  LLMConfig,
  OutputMode,
  PipelineOptions,
} from '../types/index.js';
import type { CliOptions } from './types.js';
import { register as registerGenerate } from './generate.js';
import { register as registerSearch } from './search.js';
import { register as registerEnv } from './env.js';
import { register as registerConvert } from './convert.js';
import { register as registerEval } from './eval.js';
import { register as registerServer } from './server.js';
import { register as registerLifecycle } from './lifecycle.js';
import { register as registerValidate } from './validate.js';

let cliAbortSignal: AbortSignal | undefined;

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
    );

  // 各功能域仅负责注册自身选项，业务编排仍由主入口统一处理，保证全局选项兼容。
  registerGenerate(program);
  registerSearch(program);
  registerEnv(program);
  registerConvert(program);
  registerEval(program);
  registerServer(program);
  registerLifecycle(program);
  registerValidate(program);
  program.action(runCommand);

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

  // ── 诊断 ──
  if (options.doctor) {
    const report = await runDoctor();
    printDoctorReport(report);
    return;
  }

  // ── 技能包生命周期 ──
  if (options.listSkills) {
    const skills = await listSkills();
    info('');
    info('  📦 已安装技能包');
    info('  ─────────────────────────────────');
    if (skills.length === 0) {
      info('  （空）尚未生成任何技能包');
    } else {
      for (const s of skills) {
        const icon = s.exists ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✖\x1b[0m';
        info(`  ${icon} ${s.name}  [${s.agentType}]  ${s.primaryPath}`);
      }
    }
    info('');
    return;
  }

  if (options.removeSkill) {
    const removed = await removeSkill(options.removeSkill);
    if (removed) {
      success(`已移除技能包: ${options.removeSkill}`);
    } else {
      error(`未找到技能包: ${options.removeSkill}`);
      process.exitCode = 1;
    }
    return;
  }

  // ── Repo Map ──
  if (options.repoMap) {
    const root = sources.length > 0 ? resolve(sources[0]) : process.cwd();
    const map = await generateRepoMap({ root });
    console.log(map);
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

  // ── 生成刷新工作流 ──
  if (options.generateRefreshWorkflow) {
    if (sources.length === 0) {
      error('请提供至少一个源 URL 或文件路径');
      process.exitCode = 1;
      return;
    }
    const yaml = generateRefreshWorkflow({
      sources,
      agentType: options.type || 'codex',
      model,
    });
    const { writeFileAtomic } = await import('../utils/atomic-write.js');
    const workflowPath = '.github/workflows/devtoolkit-refresh.yml';
    await writeFileAtomic(workflowPath, yaml);
    success(`已生成: ${workflowPath}`);
    return;
  }

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
    const targetAgent = options.type || 'codex';
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
    if (fromAgent !== 'auto' && !isAgentType(fromAgent)) {
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
      await searchAndPrint(
        query,
        llmConfig,
        useExplain,
        searchRoot,
        { mode: options.searchMode ?? 'hybrid' },
        {
          signal: cliAbortSignal,
          llmTimeoutMs,
        },
      );
      return;
    }

    if (options.scanCode) {
      info('╔══════════════════════════════════════╗');
      info('║   🔍 devtoolkit — 代码搜索             ║');
      info('╚══════════════════════════════════════╝');
      await startSearchSession(llmConfig, useExplain, searchRoot, {
        signal: cliAbortSignal,
        llmTimeoutMs,
        searchOptions: { mode: options.searchMode ?? 'hybrid' },
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

  const agentType: AgentType = options.type || cfg.type || 'codex';
  if (!isValidAgentType(agentType)) {
    throw new Error(
      `无效的 Agent 类型: "${agentType}"，支持: ${AGENT_TYPE_HELP}`,
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
    lang: options.lang,
    sensitivePolicy: options.sensitivePolicy,
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
        lang: options.lang,
        sensitivePolicy: options.sensitivePolicy,
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
            searchOptions: { mode: options.searchMode ?? 'hybrid' },
          },
        );
      } else if (wizardAction.query) {
        await searchAndPrint(
          wizardAction.query,
          llmConfig,
          options.explain !== false && !!llmConfig,
          wizardAction.projectRoot,
          { mode: options.searchMode ?? 'hybrid' },
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
