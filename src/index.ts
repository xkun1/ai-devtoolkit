import { Command } from 'commander';
import { runPipeline } from './pipeline.js';
import { isValidAgentType } from './format/index.js';
import { setVerbose, error, info } from './utils/logger.js';
import type { AgentType, LLMConfig } from './types/index.js';

// 内置模型预设：常用模型的默认 baseURL
const MODEL_PRESETS: Record<string, { baseURL?: string; envVar: string; description: string }> = {
  'deepseek-chat': {
    baseURL: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek Chat',
  },
  'deepseek-reasoner': {
    baseURL: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek Reasoner (R1)',
  },
  'gpt-4o': {
    baseURL: undefined,
    envVar: 'OPENAI_API_KEY',
    description: 'OpenAI GPT-4o',
  },
  'gpt-4o-mini': {
    baseURL: undefined,
    envVar: 'OPENAI_API_KEY',
    description: 'OpenAI GPT-4o-mini',
  },
  'doubao-pro-32k': {
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    envVar: 'ARK_API_KEY',
    description: '火山方舟 Doubao Pro',
  },
};

const program = new Command();

program
  .name('doc2skill')
  .description('📄→🤖 将任意网页/PDF 文档，1秒转化为 AI Agent 技能包（Cursor / Codex / Claude）')
  .version('0.1.0');

program
  .argument('<source>', '文档来源：URL 或本地文件路径')
  .option('-t, --type <type>', '目标 Agent 类型 (codex, cursor, claude)', 'codex')
  .option('-o, --out <path>', '输出文件路径')
  .option('-m, --model <model>', 'LLM 模型名', 'deepseek-chat')
  .option('--base-url <url>', 'LLM API Base URL（覆盖预设）')
  .option('--api-key <key>', 'API Key（不安全，建议用环境变量）')
  .option('-v, --verbose', '显示详细日志')
  .action(async (source, options) => {
    setVerbose(options.verbose || false);

    // 校验 agent 类型
    if (!isValidAgentType(options.type)) {
      error(`无效的 Agent 类型: ${options.type}`);
      info('  可选值: codex, cursor, claude');
      process.exit(1);
    }
    const agentType = options.type as AgentType;

    // 解析 LLM 配置
    const llmConfig = resolveLLMConfig(options);
    if (!llmConfig.apiKey) {
      const preset = MODEL_PRESETS[options.model];
      const envVar = preset?.envVar || 'OPENAI_API_KEY';
      error(`缺少 API Key。请设置环境变量 ${envVar}`);
      info('');
      info('用法示例:');
      info(`  export ${envVar}="sk-xxxxx"`);
      info(`  npx doc2skill ${source} --model ${options.model}`);
      info('');
      info('或通过参数指定:');
      info(`  npx doc2skill ${source} --api-key sk-xxxxx --model ${options.model}`);
      process.exit(1);
    }

    info('╔══════════════════════════════════════╗');
    info('║   🚀 doc2skill — 文档转技能包        ║');
    info('╚══════════════════════════════════════╝');
    info('');

    try {
      await runPipeline(source, {
        agentType,
        outputPath: options.out,
        llm: llmConfig,
        verbose: options.verbose,
      });
    } catch (err: any) {
      error(`\n❌ 执行失败: ${err.message}`);
      if (options.verbose && err.stack) {
        info(err.stack);
      }
      process.exit(1);
    }
  });

/** 解析 LLM 配置：优先级 参数 > 环境变量 > 模型预设 */
function resolveLLMConfig(options: {
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): LLMConfig {
  const preset = MODEL_PRESETS[options.model];
  const envVar = preset?.envVar || 'OPENAI_API_KEY';

  const apiKey = options.apiKey || process.env[envVar] || process.env.OPENAI_API_KEY;
  const baseURL = options.baseUrl || preset?.baseURL;

  return { apiKey: apiKey || '', baseURL, model: options.model };
}

program.parse(process.argv);
