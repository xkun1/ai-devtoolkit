/**
 * 定时自动刷新 — GitHub Actions workflow 片段生成器
 *
 * 生成 .github/workflows/devtoolkit-refresh.yml，定期重抓源 URL 并自动 PR 更新技能包。
 */
import { stringify } from 'yaml';
import { isAgentType, type AgentType } from '../agents.js';
import { PACKAGE_VERSION } from '../version.js';

export interface RefreshWorkflowOptions {
  /** 源 URL 或本地文件路径列表 */
  sources: string[];
  /** 目标 Agent 类型 */
  agentType: AgentType;
  /** Cron 表达式（默认每天 UTC 0:00） */
  cron?: string;
  /** 使用的 LLM 模型 */
  model?: string;
  /** API Key 环境变量名 */
  apiKeyEnvVar?: string;
  /** 安装的 ai-devtoolkit 精确版本，默认当前包版本。 */
  toolVersion?: string;
}

/** 生成 GitHub Actions workflow YAML */
export function generateRefreshWorkflow(
  options: RefreshWorkflowOptions,
): string {
  const cron = validateCron(options.cron || '0 0 * * *');
  const model = validateModel(options.model || 'deepseek-chat');
  const apiKeyEnv = validateEnvName(options.apiKeyEnvVar || 'DEEPSEEK_API_KEY');
  const toolVersion = validateToolVersion(
    options.toolVersion || PACKAGE_VERSION,
  );
  if (!isAgentType(options.agentType)) {
    throw new Error(`无效的 Agent 类型: ${String(options.agentType)}`);
  }
  const sources = validateSources(options.sources);
  const encodedSources = Buffer.from(JSON.stringify(sources), 'utf-8').toString(
    'base64',
  );

  const runScript = `node <<'NODE'
const { spawnSync } = require('node:child_process');
const sources = JSON.parse(Buffer.from(process.env.DEVTOOLKIT_SOURCES_B64, 'base64').toString('utf8'));
const args = [...sources, '--type', process.env.DEVTOOLKIT_AGENT_TYPE, '--model', process.env.DEVTOOLKIT_MODEL, '--force'];
const result = spawnSync('devtoolkit', args, { stdio: 'inherit', shell: false });
if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
NODE`;

  return stringify(
    {
      name: 'devtoolkit-refresh',
      on: {
        schedule: [{ cron }],
        workflow_dispatch: {},
      },
      jobs: {
        'refresh-skills': {
          'runs-on': 'ubuntu-latest',
          permissions: {
            contents: 'write',
            'pull-requests': 'write',
          },
          steps: [
            { uses: 'actions/checkout@v7' },
            {
              uses: 'actions/setup-node@v7',
              with: { 'node-version': 22 },
            },
            {
              name: 'Install devtoolkit',
              run: `npm install -g ai-devtoolkit@${toolVersion}`,
            },
            {
              name: 'Generate skill packs',
              env: {
                [apiKeyEnv]: `\${{ secrets.${apiKeyEnv} }}`,
                DEVTOOLKIT_SOURCES_B64: encodedSources,
                DEVTOOLKIT_AGENT_TYPE: options.agentType,
                DEVTOOLKIT_MODEL: model,
              },
              run: runScript,
            },
            {
              name: 'Create Pull Request',
              uses: 'peter-evans/create-pull-request@v6',
              with: {
                token: '${{ secrets.GITHUB_TOKEN }}',
                'commit-message': 'chore: 自动刷新 AI 技能包',
                title: '🔄 自动刷新技能包',
                body: `定时任务自动刷新技能包。\n\nAgent: ${options.agentType}\n模型: ${model}\n工具版本: ${toolVersion}`,
                branch: 'auto/skill-refresh',
                'delete-branch': true,
              },
            },
          ],
        },
      },
    },
    { lineWidth: 0 },
  );
}

function validateSources(sources: string[]): string[] {
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 100) {
    throw new Error('sources 必须包含 1-100 个来源');
  }
  return sources.map((source) => {
    if (
      typeof source !== 'string' ||
      !source.trim() ||
      source.length > 10_000 ||
      /[\0\r\n]/.test(source)
    ) {
      throw new Error('来源路径无效');
    }
    return source;
  });
}

function validateCron(cron: string): string {
  const fields = cron.trim().split(/ +/);
  if (
    cron !== cron.trim() ||
    cron.length > 100 ||
    /[\r\n\t]/.test(cron) ||
    fields.length !== 5 ||
    fields.some((field) => !/^[0-9*/,-]+$/.test(field))
  ) {
    throw new Error('cron 表达式无效');
  }
  return cron;
}

function validateModel(model: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model)) {
    throw new Error('模型名无效');
  }
  return model;
}

function validateEnvName(name: string): string {
  if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(name)) {
    throw new Error('API Key 环境变量名无效');
  }
  return name;
}

function validateToolVersion(version: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('工具版本无效');
  }
  return version;
}
