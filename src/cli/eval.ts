import type { Command } from 'commander';
import { parseInteger } from './parse.js';

/** 注册技能评测相关选项。 */
export function register(program: Command): void {
  program
    .option(
      '--eval <skillFile>',
      '自动生成测试集并对指定技能包进行效果与命中度对照评测',
    )
    .option(
      '--eval-concurrency <n>',
      '技能评测并发数（1-4，默认 2）',
      (value) => parseInteger(value, 'eval-concurrency', 1, 4),
    )
    .option(
      '--eval-max-cases <n>',
      '技能评测用例上限（1-20，默认 20）',
      (value) => parseInteger(value, 'eval-max-cases', 1, 20),
    );
}
