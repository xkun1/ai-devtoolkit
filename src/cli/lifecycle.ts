import type { Command } from 'commander';

/** 注册诊断及技能包生命周期相关选项。 */
export function register(program: Command): void {
  program
    .option('--doctor', '一键诊断：检查 API Key、索引、技能包健康度')
    .option('--list-skills', '列出项目中所有已生成的技能包')
    .option('--remove-skill <name>', '移除指定技能包及其产物文件');
}
