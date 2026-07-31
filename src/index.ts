import { Command } from 'commander';
import { runPipeline } from './pipeline.js';
import { isValidAgentType } from './format/index.js';
import { runWizard } from './wizard.js';
import { loadConfig } from './config.js';
import { startWatch } from './watcher.js';
import { startServer } from './server.js';
import { MODEL_PRESETS, isLocalModel, resolveModel } from './models.js';
import { setVerbose, setLogToStderr, error, info } from './utils/logger.js';
import { listTemplates } from './templates/index.js';
import type { AgentType } from './types/index.js';

const program = new Command();

program
  .name('doc2skill')
  .description(
    '📄→🤖 将任意网页/PDF 文档，1秒转化为 AI Agent 技能包（Cursor / Codex / Claude）',
  )
  .version('0.6.1');

program
  .argument(
    '[sources...]',
    '文档来源：URL 或本地文件路径（可多个，将合并为一个技能包）。无参数时进入交互式向导。',
  )
  .option('-t, --type <type>', '目标 Agent 类型 (codex, cursor, claude)')
  .option('-o, --out <path>', '输出文件路径')
  .option('-m, --model <model>', 'LLM 模型名')
  .option(
    '-n, --name <name>',
    '自定义技能名（用于 Codex SKILL.md frontmatter）',
  )
  .option('--stdout', '输出到标准输出而不写文件（便于管道集成）')
  .option('--dry-run', '预览生成结果，不写入文件')
  .option('--force', '强制覆盖已存在的输出文件')
  .option('--crawl', '爬取模式：自动发现并抓取文档站点子页面')
  .option('--crawl-depth <n>', '爬取最大深度（默认 2）')
  .option('--crawl-pages <n>', '爬取最大页面数（默认 10）')
  .option('--ui', '启动 Web UI 界面（本地浏览器交互）')
  .option('--port <n>', 'Web UI 端口号（默认 3456）')
  .option('--base-url <url>', 'LLM API Base URL（覆盖预设）')
  .option('--api-key <key>', 'API Key（不安全，建议用环境变量）')
  .option('-v, --verbose', '显示详细日志')
  .option(
    '--template <id>',
    '使用预设模板（api-doc / coding-guide / cheatsheet 等）',
  )
  .option('--list-templates', '列出所有可用模板')
  .option('--update', '增量更新：跳过未变更的文档')
  .action(async (sources: string[], options) => {
    // --list-templates：列出模板后退出
    if (options.listTemplates) {
      info('');
      info('  📋 内置模板列表');
      info('  ─────────────────────────────────');
      for (const t of listTemplates()) {
        const agents = t.agents.length ? t.agents.join('/') : '全部';
        info(`  🏷️  ${t.id.padEnd(16)} ${t.name}`);
        info(`     ${t.description}`);
        info(`     适合: ${agents}`);
        info('');
      }
      return;
    }

    // 加载配置文件，CLI 参数优先覆盖
    const cfg = await loadConfig();

    // ─── Web UI 模式 ───
    if (options.ui) {
      const port = options.port ? parseInt(options.port, 10) : 3456;
      startServer({
        port,
        apiKey:
          options.apiKey ||
          process.env.DEEPSEEK_API_KEY ||
          process.env.OPENAI_API_KEY ||
          '',
        baseURL: options.baseUrl,
        model: options.model || cfg.model || 'deepseek-chat',
      });
      // 尝试自动打开浏览器
      try {
        const openUrl = 'http://localhost:' + port;
        const { exec } = await import('node:child_process');
        const cmd =
          process.platform === 'darwin'
            ? 'open'
            : process.platform === 'win32'
              ? 'start'
              : 'xdg-open';
        exec(cmd + ' ' + openUrl);
      } catch {
        // 忽略打开失败
      }
      return; // 不退出进程，保持服务运行
    }

    // 合并优先级：CLI 参数 > 配置文件 > 内置默认值
    const model = options.model || cfg.model || 'deepseek-chat';
    const agentTypeRaw = options.type || cfg.type || 'codex';
    const outputPath = options.out || cfg.out;
    const skillName = options.name || cfg.name;
    const templateId = options.template || cfg.template;
    const baseUrl = options.baseUrl || cfg.baseUrl;
    const apiKey = options.apiKey || cfg.apiKey;
    const verbose = options.verbose || cfg.verbose || false;

    setVerbose(verbose);
    if (options.stdout) {
      setLogToStderr(true);
    }

    // ─── 无参数 → 交互式向导 ───
    if (!sources || sources.length === 0) {
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
        });
      } catch (err: any) {
        if (err?.name === 'ExitPromptError') {
          info('\n  已退出');
          return;
        }
        error(`\n❌ 执行失败: ${err.message}`);
        process.exit(1);
      }
      return;
    }

    // ─── 有参数 → 命令行模式 ───
    if (!isValidAgentType(agentTypeRaw)) {
      error(`无效的 Agent 类型: ${agentTypeRaw}`);
      info('  可选值: codex, cursor, claude');
      process.exit(1);
    }
    const agentType = agentTypeRaw as AgentType;

    const llmConfig = resolveModel(model, { apiKey, baseUrl });

    // 本地模型跳过 API Key 检查
    if (!isLocalModel(model) && !llmConfig.apiKey) {
      const preset = MODEL_PRESETS[model];
      const envVar = preset?.envVar || 'OPENAI_API_KEY';
      error(`缺少 API Key。请设置环境变量 ${envVar}`);
      info('');
      info('用法示例:');
      info(`  export ${envVar}="sk-xxxxx"`);
      info(`  npx doc2skill ${sources[0]} --model ${model}`);
      info('');
      info('或通过参数指定:');
      info(`  npx doc2skill ${sources[0]} --api-key sk-xxxxx --model ${model}`);
      info('');
      info('或使用本地模型（免费/离线）:');
      info(`  npx doc2skill ${sources[0]} --model ollama-local`);
      info('');
      info('或直接运行 npx doc2skill 不带参数进入交互式向导');
      process.exit(1);
    }

    // ─── watch 模式 ───
    if (options.watch) {
      try {
        startWatch(sources, {
          agentType,
          outputPath,
          llm: llmConfig,
          verbose,
          name: skillName,
          stdout: false,
          dryRun: false,
          force: true, // watch 模式下总是覆盖
          crawl: options.crawl || false,
          crawlDepth: options.crawlDepth
            ? parseInt(options.crawlDepth, 10)
            : undefined,
          crawlPages: options.crawlPages
            ? parseInt(options.crawlPages, 10)
            : undefined,
        });
      } catch (err: any) {
        error(`\n❌ watch 模式启动失败: ${err.message}`);
        process.exit(1);
      }
      return; // watch 模式不退出进程，持续监控
    }

    if (!options.stdout && !options.dryRun) {
      info('╔══════════════════════════════════════╗');
      info('║   🚀 doc2skill — 文档转技能包        ║');
      info('╚══════════════════════════════════════╝');
      info('');
    }

    try {
      await runPipeline(sources, {
        agentType,
        outputPath,
        llm: llmConfig,
        verbose,
        name: skillName,
        stdout: options.stdout || false,
        dryRun: options.dryRun || false,
        force: options.force || false,
        crawl: options.crawl || false,
        crawlDepth: options.crawlDepth
          ? parseInt(options.crawlDepth, 10)
          : undefined,
        crawlPages: options.crawlPages
          ? parseInt(options.crawlPages, 10)
          : undefined,
        template: templateId,
        incremental: options.update || false,
      });
    } catch (err: any) {
      error(`\n❌ 执行失败: ${err.message}`);
      if (verbose && err.stack) {
        info(err.stack);
      }
      process.exit(1);
    }
  });

program.parse(process.argv);
