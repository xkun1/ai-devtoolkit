/**
 * 定时自动刷新 — GitHub Actions workflow 片段生成器
 *
 * 生成 .github/workflows/devtoolkit-refresh.yml，定期重抓源 URL 并自动 PR 更新技能包。
 */

export interface RefreshWorkflowOptions {
  /** 源 URL 或本地文件路径列表 */
  sources: string[];
  /** 目标 Agent 类型 */
  agentType: string;
  /** Cron 表达式（默认每天 UTC 0:00） */
  cron?: string;
  /** 使用的 LLM 模型 */
  model?: string;
  /** API Key 环境变量名 */
  apiKeyEnvVar?: string;
}

/** 生成 GitHub Actions workflow YAML */
export function generateRefreshWorkflow(
  options: RefreshWorkflowOptions,
): string {
  const cron = options.cron || '0 0 * * *';
  const model = options.model || 'deepseek-chat';
  const apiKeyEnv = options.apiKeyEnvVar || 'DEEPSEEK_API_KEY';
  const sources = options.sources.map((s) => `"${s}"`).join(' ');

  return `name: devtoolkit-refresh

on:
  schedule:
    - cron: '${cron}'
  workflow_dispatch:

jobs:
  refresh-skills:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install devtoolkit
        run: npm install -g ai-devtoolkit

      - name: Generate skill packs
        env:
          ${apiKeyEnv}: \${{ secrets.${apiKeyEnv} }}
        run: |
          devtoolkit ${sources} --type ${options.agentType} --model ${model} --force

      - name: Create Pull Request
        uses: peter-evans/create-pull-request@v6
        with:
          token: \${{ secrets.GITHUB_TOKEN }}
          commit-message: 'chore: 自动刷新 AI 技能包'
          title: '🔄 自动刷新技能包'
          body: |
            定时任务自动刷新技能包。

            源文档: ${options.sources.join(', ')}
            Agent: ${options.agentType}
            模型: ${model}
          branch: auto/skill-refresh
          delete-branch: true
`;
}
