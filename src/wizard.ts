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

import {
  MODEL_DISPLAY,
  MODEL_PRESETS,
  isLocalModel,
  resolveModel,
} from './models.js';
import { detectLocalModels } from './models.js';

const MODEL_CHOICES = MODEL_DISPLAY.map((m) => ({ name: m.name, value: m.id }));
const MODEL_ENV: Record<string, string> = {};
const MODEL_BASE: Record<string, string | undefined> = {};
for (const m of MODEL_DISPLAY) {
  MODEL_ENV[m.id] = m.envVar;
  MODEL_BASE[m.id] = MODEL_PRESETS[m.id]?.baseURL;
}

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

  // 5. API Key（本地模型跳过）
  let apiKey = '';
  // 本地模型：动态地址 + 探测模型列表
  let localBaseUrl: string | undefined;
  let localModelName: string | undefined;

  if (!isLocalModel(model)) {
    const envVar = MODEL_ENV[model] || 'OPENAI_API_KEY';
    const envKey = process.env[envVar] || process.env.OPENAI_API_KEY || '';
    apiKey = envKey;
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
  } else {
    // 本地模型：输入服务地址 → 自动探测 → 选择模型
    localBaseUrl = await promptLocalBaseURL(model);
    const detected = await detectAndSelectModel(localBaseUrl);
    localModelName = detected;
    success('使用本地模型，无需 API Key');
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
  if (localModelName) info(`  🔧 本地模型: ${localModelName}`);
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
    llm: resolveModel(model, {
      apiKey,
      baseUrl: localBaseUrl || MODEL_BASE[model],
      localModelName,
    }),
  };
}

/** 提示输入本地模型服务地址 */
async function promptLocalBaseURL(model: string): Promise<string> {
  const preset = MODEL_PRESETS[model];
  const hint = preset?.baseURL || 'http://localhost:11434';
  // 去掉末尾的 /v1，只保留基础地址
  const defaultUrl = hint.replace(/\/v1\/?$/, '');
  return input({
    message: '🏠 输入本地模型服务地址：',
    default: defaultUrl,
    validate: (v) => (/^https?:\/\//i.test(v.trim()) ? true : '请输入完整 URL'),
  });
}

/** 探测本地服务可用模型并让用户选择 */
async function detectAndSelectModel(baseUrl: string): Promise<string> {
  info('  🔍 正在探测本地可用模型...');
  const models = await detectLocalModels(baseUrl);
  if (models.length === 0) {
    info('  ⚠ 未能自动探测到模型列表，请手动输入模型名');
    return input({
      message: '🧠 输入本地模型名称：',
      validate: (v) => (v.trim() ? true : '不能为空'),
    });
  }
  success(`探测到 ${models.length} 个可用模型`);
  return select({
    message: '选择要使用的模型：',
    choices: models.map((m) => ({ name: m.name, value: m.id })),
  });
}
