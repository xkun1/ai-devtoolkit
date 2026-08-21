/**
 * 多模型对比评测
 *
 * 同一技能 × 多个模型的评测矩阵，输出 Markdown 对比报告。
 */
import type { LLMConfig } from '../types/index.js';
import type { EvalReport } from './types.js';
import { runSkillEval } from './runner.js';

export interface MultiModelOptions {
  /** 技能包正文 */
  skillContent: string;
  /** 多个模型配置 */
  models: { label: string; llm: LLMConfig }[];
  /** 每个模型的评测选项 */
  evalOptions?: {
    maxCases?: number;
    concurrency?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  };
}

export interface MultiModelResult {
  results: { label: string; report: EvalReport | null; error?: string }[];
  bestModel: string | null;
}

/** 运行多模型对比评测 */
export async function runMultiModelEval(
  options: MultiModelOptions,
): Promise<MultiModelResult> {
  const results: MultiModelResult['results'] = [];

  for (const model of options.models) {
    try {
      const report = await runSkillEval(options.skillContent, {
        llm: model.llm,
        ...options.evalOptions,
      });
      results.push({ label: model.label, report });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ label: model.label, report: null, error: message });
    }
  }

  // 找出得分最高的模型
  let bestModel: string | null = null;
  let bestScore = -1;
  for (const r of results) {
    if (r.report && r.report.overallScore > bestScore) {
      bestScore = r.report.overallScore;
      bestModel = r.label;
    }
  }

  return { results, bestModel };
}

/** 格式化多模型对比报告为 Markdown */
export function formatMultiModelReport(result: MultiModelResult): string {
  const lines: string[] = [];

  lines.push('# 📊 多模型对比评测报告');
  lines.push('');
  lines.push('| 模型 | 综合得分 | 评级 | 触发命中 | 准确度 | 基线 | 增益 |');
  lines.push('|------|---------|------|---------|--------|------|------|');

  for (const r of result.results) {
    if (!r.report) {
      lines.push(`| ${r.label} | ❌ 失败 | - | - | - | - | - |`);
      continue;
    }
    const rep = r.report;
    const gain =
      rep.avgImprovementScore >= 0
        ? `+${rep.avgImprovementScore}`
        : `${rep.avgImprovementScore}`;
    lines.push(
      `| ${r.label} | ${rep.overallScore} | ${rep.grade} | ${rep.avgTriggerScore} | ${rep.avgAccuracyScore} | ${rep.avgBaselineScore} | ${gain} |`,
    );
  }

  lines.push('');
  if (result.bestModel) {
    lines.push(`🏆 **最佳模型**: ${result.bestModel}`);
  }
  lines.push('');

  return lines.join('\n');
}
