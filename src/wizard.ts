/**
 * 交互式向导 — 无参数运行时引导用户完成各项功能配置
 */
import { input, select, confirm } from '@inquirer/prompts';
import { resolve } from 'node:path';
import type { AgentType, LLMConfig } from './types/index.js';
import { info, success, error } from './utils/logger.js';
import {
  MODEL_DISPLAY,
  MODEL_PRESETS,
  isLocalModel,
  resolveModel,
  detectLocalModels,
} from './models.js';

export interface WizardResult {
  sources: string[];
  agentType: AgentType;
  outputPath?: string;
  llm: LLMConfig;
  name?: string;
}

export type WizardAction =
  | { mode: 'skill'; data: WizardResult }
  | {
      mode: 'search';
      projectRoot: string;
      query?: string;
      interactive: boolean;
    }
  | {
      mode: 'env';
      subAction: 'export' | 'diff' | 'import';
      file?: string;
      execute?: boolean;
    }
  | { mode: 'convert'; file: string; to: AgentType }
  | {
      mode: 'sync';
      projectRoot: string;
      from?: AgentType;
      to?: AgentType[];
      dryRun: boolean;
    }
  | { mode: 'ui'; port?: number }
  | null;

const MODEL_CHOICES = MODEL_DISPLAY.map((m) => ({ name: m.name, value: m.id }));
const MODEL_ENV: Record<string, string> = {};
const MODEL_BASE: Record<string, string | undefined> = {};
for (const m of MODEL_DISPLAY) {
  MODEL_ENV[m.id] = m.envVar;
  MODEL_BASE[m.id] = MODEL_PRESETS[m.id]?.baseURL;
}

const AGENT_CHOICES = [
  { name: '🤖 Codex   → .agents/skills/  (Codex Agent 技能)', value: 'codex' },
  { name: '🎯 Cursor  → .cursor/rules/   (Cursor 项目规则)', value: 'cursor' },
  {
    name: '🧠 Claude  → CLAUDE.md        (Claude Code 项目记忆)',
    value: 'claude',
  },
];

const MAIN_MENU_CHOICES = [
  {
    name: '📄 1. 生成 AI 技能包  (Doc2Skill: 从文档/网页提炼 Codex/Cursor 技能)',
    value: 'skill',
  },
  {
    name: '🔄 2. 跨 Agent 规则互转与同步 (Cursor ⇄ Codex ⇄ Claude 双向转换/全量同步)',
    value: 'convert',
  },
  {
    name: '🔍 3. 代码搜索与解释 (扫描项目代码，支持自然语言搜索与 LLM 解释)',
    value: 'search',
  },
  {
    name: '📦 4. 开发环境迁移  (导出/恢复/比对 Homebrew, npm, pip, VSCode 等)',
    value: 'env',
  },
  {
    name: '🌐 5. 启动 Web UI 工作台 (在浏览器中可视化操作)',
    value: 'ui',
  },
];

export async function runWizard(): Promise<WizardAction> {
  info('');
  info('  ╔══════════════════════════════════════════╗');
  info('  ║  🚀 devtoolkit 开发者工具箱                ║');
  info('  ║  AI 技能包生成 · 规则互转 · 代码搜索 · 环境迁移 ║');
  info('  ╚══════════════════════════════════════════╝');
  info('');

  const selectedMode = await select({
    message: '🛠️ 请选择要使用的功能：',
    choices: MAIN_MENU_CHOICES,
  });

  if (selectedMode === 'skill') {
    const result = await runSkillWizard();
    return result ? { mode: 'skill', data: result } : null;
  }

  if (selectedMode === 'convert') {
    return await runConvertWizard();
  }

  if (selectedMode === 'search') {
    return await runSearchWizard();
  }

  if (selectedMode === 'env') {
    return await runEnvWizard();
  }

  if (selectedMode === 'ui') {
    const portStr = await input({
      message: '🌐 Web UI 端口号（默认 3456）：',
      default: '3456',
    });
    const port = Number(portStr) || 3456;
    return { mode: 'ui', port };
  }

  return null;
}

/** 跨 Agent 规则互转与同步向导 */
async function runConvertWizard(): Promise<WizardAction> {
  info('');
  info('  ── 🔄 跨 Agent 规则互转与同步 ──');
  info('');

  const subType = await select({
    message: '选择操作类型：',
    choices: [
      {
        name: '⚡ 1. 同步项目现有规则到其他 Agent (一键分发到 Cursor/Codex/Claude)',
        value: 'sync',
      },
      {
        name: '📄 2. 转换单个规则文件 (例如 .mdc -> SKILL.md 或 CLAUDE.md)',
        value: 'single',
      },
    ],
  });

  if (subType === 'sync') {
    const rootInput = await input({
      message: '📁 项目根目录路径（回车使用当前目录）：',
      default: process.cwd(),
    });
    const dryRun = await confirm({
      message: '是否先进行 dry-run 预览？(选 No 则实际写入文件)',
      default: false,
    });
    return {
      mode: 'sync',
      projectRoot: resolve(rootInput),
      dryRun,
    };
  }

  const filePath = await input({
    message:
      '📄 输入要转换的规则文件路径 (如 .cursor/rules/api.mdc 或 SKILL.md)：',
    validate: (v) => (v.trim() ? true : '文件路径不能为空'),
  });

  const toAgent = (await select({
    message: '🎯 转换目标 Agent：',
    choices: AGENT_CHOICES,
  })) as AgentType;

  return {
    mode: 'convert',
    file: filePath.trim(),
    to: toAgent,
  };
}

/** 技能包生成向导 */
async function runSkillWizard(): Promise<WizardResult | null> {
  info('');
  info('  ── 📄 AI 技能包生成配置 ──');
  info('');

  const sourceInput = await input({
    message: '📄 文档来源（URL 或本地文件路径，多个用逗号隔开）：',
    validate: (v) => (v.trim() ? true : '不能为空'),
  });
  const sources = sourceInput
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const agentType = (await select({
    message: '🤖 目标 Agent 类型：',
    choices: AGENT_CHOICES,
  })) as AgentType;

  let name: string | undefined;
  if (agentType === 'codex') {
    const customName = await input({
      message: '🏷️  技能名（回车跳过，将从文档标题自动生成）：',
      default: '',
    });
    if (customName.trim()) name = customName.trim();
  }

  const model = (await select({
    message: '🧠 选择 LLM 模型：',
    choices: MODEL_CHOICES,
  })) as string;

  let apiKey = '';
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
    localBaseUrl = await promptLocalBaseURL(model);
    const detected = await detectAndSelectModel(localBaseUrl);
    localModelName = detected;
    success('使用本地模型，无需 API Key');
  }

  const customOut = await input({
    message: '💾 自定义主文件路径（回车使用推荐结构）：',
    default: '',
  });
  const outputPath = customOut.trim() || undefined;

  info('');
  info('  ─────────────────────────────────');
  info(`  📄 来源:    ${sources.join(', ')}`);
  info(`  🤖 Agent:  ${agentType}`);
  if (name) info(`  🏷️  技能名:  ${name}`);
  info(`  🧠 模型:    ${model}`);
  if (localModelName) info(`  🔧 本地模型: ${localModelName}`);
  info(`  💾 输出:    ${outputPath || '自动（推荐目录结构）'}`);
  info('  ─────────────────────────────────');
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

/** 代码搜索向导 */
async function runSearchWizard(): Promise<WizardAction> {
  info('');
  info('  ── 🔍 代码搜索配置 ──');
  info('');

  const rootInput = await input({
    message: '📁 项目根目录路径（回车使用当前目录）：',
    default: process.cwd(),
  });
  const projectRoot = resolve(rootInput);

  const searchType = await select({
    message: '🔎 搜索方式：',
    choices: [
      { name: '💬 进入交互式搜索会话 (REPL 模式，推荐)', value: 'interactive' },
      { name: '⚡ 单次搜索', value: 'single' },
    ],
  });

  if (searchType === 'interactive') {
    return {
      mode: 'search',
      projectRoot,
      interactive: true,
    };
  }

  const query = await input({
    message: '🔎 输入搜索内容（支持自然语言或 path:src/ 等语法）：',
    validate: (v) => (v.trim() ? true : '搜索内容不能为空'),
  });

  return {
    mode: 'search',
    projectRoot,
    query: query.trim(),
    interactive: false,
  };
}

/** 环境迁移向导 */
async function runEnvWizard(): Promise<WizardAction> {
  info('');
  info('  ── 📦 开发环境迁移 ──');
  info('');

  const action = await select({
    message: '⚙️ 请选择操作：',
    choices: [
      {
        name: '📤 1. 导出当前开发环境快照 (生成 JSON 与 setup.sh)',
        value: 'export',
      },
      { name: '📊 2. 比对环境差异 (对比快照与当前电脑差异)', value: 'diff' },
      {
        name: '📥 3. 从快照恢复环境 (Dry-run 预览 / 实际安装)',
        value: 'import',
      },
    ],
  });

  if (action === 'export') {
    return { mode: 'env', subAction: 'export' };
  }

  const defaultFile = 'devtoolkit-env.json';
  const filePath = await input({
    message: '📄 输入快照文件路径：',
    default: defaultFile,
    validate: (v) => (v.trim() ? true : '文件路径不能为空'),
  });

  if (action === 'diff') {
    return { mode: 'env', subAction: 'diff', file: filePath.trim() };
  }

  const execute = await confirm({
    message: '是否直接执行安装命令？(选 No 则仅预览 Dry-run 命令)',
    default: false,
  });

  return {
    mode: 'env',
    subAction: 'import',
    file: filePath.trim(),
    execute,
  };
}

async function promptLocalBaseURL(model: string): Promise<string> {
  const preset = MODEL_PRESETS[model];
  const hint = preset?.baseURL || 'http://localhost:11434';
  const defaultUrl = hint.replace(/\/v1\/?$/, '');
  return input({
    message: '🏠 输入本地模型服务地址：',
    default: defaultUrl,
    validate: (v) => (/^https?:\/\//i.test(v.trim()) ? true : '请输入完整 URL'),
  });
}

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
