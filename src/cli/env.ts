import type { Command } from 'commander';

/** 注册环境迁移相关选项。 */
export function register(program: Command): void {
  program
    .option(
      '--env-export',
      '导出当前开发环境配置（Homebrew/npm/pip/SDK/VSCode 等），生成快照和安装脚本',
    )
    .option(
      '--env-import <file>',
      '从环境快照 JSON 恢复（dry-run 预览，加 --execute 执行安装）',
    )
    .option('--env-diff <file>', '比对当前机器与指定环境快照 JSON 的差异')
    .option(
      '--execute',
      '配合 --env-import 使用：实际执行安装命令（不加则只预览）',
    );
}
