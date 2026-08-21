import type { Command } from 'commander';

/** 注册规则互转与同步相关选项。 */
export function register(program: Command): void {
  program
    .option(
      '--convert <file>',
      '转换指定的规则文件（结合 -t/--type 指定目标 Agent）',
    )
    .option('--sync', '自动发现并同步项目中的全部 Agent 规则')
    .option('--sync-from <agent>', '同步源 Agent（默认自动检测）')
    .option(
      '--sync-to <agents>',
      '同步目标 Agent（多个用逗号隔开，如 cursor,claude）',
    );
}
