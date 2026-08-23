import type { Command } from 'commander';
import { AGENT_TYPES, AGENT_TYPE_HELP } from '../agents.js';
import { parseChoice, parseInteger } from './parse.js';

/** 注册技能包生成及刷新工作流相关选项。 */
export function register(program: Command): void {
  program
    .option(
      '-t, --type <type>',
      `目标 Agent 类型 (${AGENT_TYPE_HELP})`,
      (value) => parseChoice(value, 'type', AGENT_TYPES),
    )
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
    .option('--merge', '目录模式下合并所有文件为一个技能包')
    .option(
      '--dir-depth <n>',
      '目录扫描最大递归深度（1-20，默认 5）',
      (value) => parseInteger(value, 'dir-depth', 1, 20),
    )
    .option(
      '--lang <lang>',
      '强制技能包输出语言: zh | en | auto (默认 auto 跟随源文档)',
      (value) => parseChoice(value, 'lang', ['zh', 'en', 'auto'] as const),
    )
    .option(
      '--sensitive-policy <policy>',
      '敏感信息策略: redact (默认脱敏) | error (阻断) | off (关闭)',
      (value) =>
        parseChoice(value, 'sensitive-policy', [
          'redact',
          'error',
          'off',
        ] as const),
    )
    .option(
      '--generate-refresh-workflow',
      '生成 GitHub Actions 定时刷新技能包 workflow',
    );
}
