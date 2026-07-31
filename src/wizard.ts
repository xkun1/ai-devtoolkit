/**
 * 交互式向导 — 无参数运行时引导用户完成配置
 */
import { input, select, confirm } from '@inquirer/prompts';
import type { AgentType, LLMConfig } from './types/index.js';
import { info, success, error } from './utils/logger.js';

export interface WizardResult {
  sources: string[];
  agentType: AgentType;
  outputPath?: string;
  llm: LLMConfig;
  name?: string;
}

const MODEL_CHOICES = [
  { name: 'DeepSeek Chat  (性价比之王)', value: 'deepseek-chat' },
  { name: 'DeepSeek Reasoner (R1 推理)', value: 'deepseek-reasoner' },
  { name: 'GPT-4o  (OpenAI 旗舰)', value: 'gpt-4o' },
  { name: 'GPT-4o mini  (OpenAI 轻量)', value: 'gpt-4o-mini' },
  { name: 'Doubao Pro 32k  (火山方舟)', value: 'doubao-pro-32k' },
];

const MODEL_ENV: Record<string, string> = {
  'deepseek-chat': 'DEEPSEEK_API_KEY',
  'deepseek-reasoner': 'DEEPSEEK_API_KEY',
  'gpt-4o': 'OPENAI_API_KEY',
  'gpt-4o-mini': 'OPENAI_API_KEY',
  'doubao-pro-32k': 'ARK_API_KEY',
};

const MODEL_BASE: Record<string, string | undefined> = {
  'deepseek-chat': 'https://api.deepseek.com/v1',
  'deepseek-reasoner': 'https://api.deepseek.com/v1',
  'gpt-4o': undefined,
  'gpt-4o-mini': undefined,
  'doubao-pro-32k': 'https://ark.cn-beijing.volces.com/api/v3',
};

const AGENT_CHOICES = [
  { name: '🤖 Codex   → SKILL.md         (Codex Agent 技能)', value: 'codex' },
  { name: '🎯 Cursor  → .cursorrules     (Cursor 编码规则)', value: 'cursor' },
  {
    name: '🧠 Claude  → CLAUDE.md        (Claude Code 项目记忆)',
    value: 'claude',
  },
];

const DEFAULT_OUTPUT: Record<AgentType, string> = {
  codex: './SKILL.md',
  cursor: './.cursorrules',
  claude: './CLAUDE.md',
};

export async function runWizard(): Promise<WizardResult | null> {
  info('');
  info('  ╔══════════════════════════════════════════╗');
  info('  ║  🚀 doc2skill 交互式向导                 ║');
  info('  ║  让我们一起把文档变成 AI 技能包！        ║');
  info('  ╚══════════════════════════════════════════╝');
  info('');

  // 1. 文档来源
  const sourceInput = await input({
    message: '📄 文档来源（URL 或本地文件路径）：',
    validate: (v) => (v.trim() ? true : '不能为空'),
  });
  const sources = sourceInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  // 2. Agent 类型
  const agentType = (await select({
    message: '🤖 目标 Agent 类型：',
    choices: AGENT_CHOICES,
  })) as AgentType;

  // 3. 自定义技能名（codex 时可选）
  let name: string | undefined;
  if (agentType === 'codex') {
    const customName = await input({
      message: '🏷️  技能名（回车跳过，将从文档标题自动生成）：',
      default: '',
    });
    if (customName.trim()) name = customName.trim();
  }

  // 4. 模型选择
  const model = (await select({
    message: '🧠 选择 LLM 模型：',
    choices: MODEL_CHOICES,
  })) as string;

  // 5. API Key
  const envVar = MODEL_ENV[model] || 'OPENAI_API_KEY';
  const envKey = process.env[envVar] || process.env.OPENAI_API_KEY || '';
  let apiKey = envKey;
  if (!apiKey) {
    info('');
    info(`  ⚠ 未检测到 ${envVar} 环境变量`);
    apiKey = await input({
      message: `🔑 输入 API Key（或设置 ${envVar} 后重试）：`,
      validate: (v) => (v.trim() ? true : 'API Key 不能为空'),
    });
  } else {
    success(`已检测到 ${envVar} 环境变量`);
  }

  // 6. 输出路径
  const defaultOut = DEFAULT_OUTPUT[agentType];
  const customOut = await input({
    message: '💾 输出文件路径：',
    default: defaultOut,
  });
  const outputPath = customOut.trim() || defaultOut;

  // 7. 确认
  info('');
  info('  ─────────────────────────────────');
  info(`  📄 来源:    ${sources.join(', ')}`);
  info(`  🤖 Agent:  ${agentType}`);
  if (name) info(`  🏷️  技能名:  ${name}`);
  info(`  🧠 模型:    ${model}`);
  info(`  💾 输出:    ${outputPath}`);
  info('  ─────────────────────────────────────────');
  info('');

  const confirmed = await confirm({
    message: '确认生成？',
    default: true,
  });

  if (!confirmed) {
    error('已取消');
    return null;
  }

  return {
    sources,
    agentType,
    outputPath,
    name,
    llm: {
      apiKey,
      baseURL: MODEL_BASE[model],
      model,
    },
  };
}
