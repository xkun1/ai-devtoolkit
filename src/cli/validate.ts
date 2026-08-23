import type { Command } from 'commander';
import {
  formatSkillValidationSummary,
  validateSkillTarget,
} from '../skill/validate.js';

interface ValidateCommandOptions {
  strict?: boolean;
  json?: boolean;
  checkLinks?: boolean;
}

/** 注册 Agent Skills 规范校验子命令。 */
export function register(program: Command): void {
  program
    .command('validate [path]')
    .description('校验 Skill 目录、SKILL.md 或项目中的全部 Agent Skills')
    .option('--strict', '严格模式：存在警告时也返回失败')
    .option('--json', '输出机器可读 JSON')
    .option('--no-check-links', '跳过本地引用文件存在性与边界检查')
    .action(
      async (path: string | undefined, options: ValidateCommandOptions) => {
        const summary = await validateSkillTarget(path || '.', {
          strict: options.strict,
          checkLinks: options.checkLinks,
        });
        if (options.json) {
          process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else {
          process.stdout.write(`${formatSkillValidationSummary(summary)}\n`);
        }
        if (!summary.passed) process.exitCode = 1;
      },
    );
}
