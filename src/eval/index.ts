/**
 * 技能效果评测 (Skill Eval) 统一入口
 */
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import type {
  CaseEvalResult,
  EvalCase,
  EvalReport,
  EvalSuite,
  GenerateEvalOptions,
  RunEvalOptions,
} from './types.js';
import { generateEvalSuite, generateFallbackCases } from './generator.js';
import { runSkillEval, formatEvalReportMarkdown } from './runner.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import {
  info,
  success,
  startSpinner,
  succeedSpinner,
  failSpinner,
} from '../utils/logger.js';

export {
  generateEvalSuite,
  generateFallbackCases,
  runSkillEval,
  formatEvalReportMarkdown,
};

export type {
  EvalCase,
  EvalSuite,
  CaseEvalResult,
  EvalReport,
  GenerateEvalOptions,
  RunEvalOptions,
};

/**
 * 评测指定技能文件（CLI 包装）
 */
export async function evalSkillFile(
  filePath: string,
  options: RunEvalOptions,
  saveReport = true,
): Promise<EvalReport> {
  const absPath = resolve(filePath);
  info(`📄 正在读取技能文件: ${absPath}`);
  const content = await readFile(absPath, 'utf-8');

  startSpinner('🤖 正在生成测试用例并执行对照评测...');
  let report: EvalReport;
  try {
    report = await runSkillEval(content, options, absPath);
    succeedSpinner(
      `评测完成！得分: ${report.overallScore} 分 (${report.grade} 级)`,
    );
  } catch (err: any) {
    failSpinner(`评测失败: ${err.message}`);
    throw err;
  }

  const markdown = formatEvalReportMarkdown(report);
  console.log('\n' + markdown);

  if (saveReport) {
    const reportPath = join(
      options.outputDir || process.cwd(),
      `eval-report-${report.skillName}.md`,
    );
    await writeFileAtomic(reportPath, markdown);
    success(`评测报告已保存至: ${reportPath}`);
  }

  return report;
}
