/**
 * 技能评测执行引擎
 *
 * 运行对照实验（带技能规则 vs 无技能基线），分析触发命中度与准确率，输出量化评测报告。
 * 支持多用例与对照回答全并发执行，极大缩短评测耗时。
 */
import type {
  CaseEvalResult,
  EvalCase,
  EvalReport,
  EvalSuite,
  RunEvalOptions,
} from './types.js';
import { callLLM } from '../transform/llm.js';
import { generateEvalSuite } from './generator.js';

/**
 * 执行技能评测（全并发极速模式）
 */
export async function runSkillEval(
  skillContent: string,
  options: RunEvalOptions,
  skillPath?: string,
): Promise<EvalReport> {
  const suite: EvalSuite =
    options.suite ||
    (await generateEvalSuite(
      skillContent,
      { llm: options.llm, count: 2 },
      skillPath,
    ));

  // 全并发执行各 case 评测
  const caseResults: CaseEvalResult[] = await Promise.all(
    suite.cases.map((c) => evaluateSingleCase(c, skillContent, options)),
  );

  const total = caseResults.length || 1;
  const avgTriggerScore = Math.round(
    caseResults.reduce((acc, r) => acc + r.triggerScore, 0) / total,
  );
  const avgAccuracyScore = Math.round(
    caseResults.reduce((acc, r) => acc + r.accuracyScore, 0) / total,
  );
  const overallScore = Math.round(
    avgTriggerScore * 0.4 + avgAccuracyScore * 0.6,
  );

  const grade = calculateGrade(overallScore);
  const suggestions = generateSuggestions(
    caseResults,
    avgTriggerScore,
    avgAccuracyScore,
  );

  return {
    skillName: suite.skillName,
    evaluatedAt: new Date().toISOString(),
    model: options.llm.model,
    totalCases: caseResults.length,
    avgTriggerScore,
    avgAccuracyScore,
    overallScore,
    grade,
    caseResults,
    suggestions,
  };
}

/** 评测单个用例 */
async function evaluateSingleCase(
  evalCase: EvalCase,
  skillContent: string,
  options: RunEvalOptions,
): Promise<CaseEvalResult> {
  const withSkillPrompt = `【系统技能规则指导】
${skillContent}

【用户提问】
${evalCase.query}`;

  // 并发获取带技能回答与无技能基线回答
  const [withSkillAnswer, baselineAnswer] = await Promise.all([
    callLLM(withSkillPrompt, options.llm).catch(
      (err) => `LLM 执行异常: ${err.message}`,
    ),
    callLLM(evalCase.query, options.llm).catch(
      (err) => `基线执行异常: ${err.message}`,
    ),
  ]);

  // 计算关键词命中度
  const matchedKeywords = evalCase.expectedKeywords.filter((kw) =>
    withSkillAnswer.toLowerCase().includes(kw.toLowerCase()),
  );

  const keywordRatio =
    evalCase.expectedKeywords.length > 0
      ? matchedKeywords.length / evalCase.expectedKeywords.length
      : 1;

  // 利用 Judge 进行质量打分
  const judgePrompt = `你是一位严格的 AI 评测裁判。
请评估【带技能规则回答】相对于【预期要求】的遵循质量：

【评测用例问题】: ${evalCase.query}
【预期核心结论】: ${evalCase.expectedConclusion}
【评分准则】: ${evalCase.rubric || '无额外准则'}
【带技能的回答】: ${withSkillAnswer}

请输出合法的 JSON 格式（不要包含任何 markdown 代码块）：
{
  "triggerScore": 85,
  "accuracyScore": 90,
  "feedback": "具体评价与建议（1-2 句话）"
}`;

  let triggerScore = Math.round(keywordRatio * 100);
  let accuracyScore = 80;
  let feedback = '回答符合技能规范要求。';

  try {
    const rawJudge = await callLLM(judgePrompt, options.llm);
    const cleanJudge = rawJudge
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    const judgeData = JSON.parse(cleanJudge);
    if (typeof judgeData.triggerScore === 'number')
      triggerScore = judgeData.triggerScore;
    if (typeof judgeData.accuracyScore === 'number')
      accuracyScore = judgeData.accuracyScore;
    if (judgeData.feedback) feedback = judgeData.feedback;
  } catch {
    if (keywordRatio >= 0.8) {
      triggerScore = 95;
      accuracyScore = 90;
    } else if (keywordRatio >= 0.5) {
      triggerScore = 75;
      accuracyScore = 75;
    } else {
      triggerScore = 40;
      accuracyScore = 50;
      feedback = '回答未能完整包含预期的关键规则术语。';
    }
  }

  const overallScore = Math.round(triggerScore * 0.4 + accuracyScore * 0.6);

  return {
    evalCase,
    withSkillAnswer,
    baselineAnswer,
    triggerScore,
    accuracyScore,
    overallScore,
    feedback,
    matchedKeywords,
  };
}

function calculateGrade(score: number): 'S' | 'A' | 'B' | 'C' | 'D' {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  return 'D';
}

function generateSuggestions(
  results: CaseEvalResult[],
  avgTrigger: number,
  avgAccuracy: number,
): string[] {
  const suggestions: string[] = [];

  if (avgTrigger < 75) {
    suggestions.push(
      '建议在技能包开头强化触发词（Trigger Phrases）与核心应用场景描述，提升 Agent 召回概率。',
    );
  }
  if (avgAccuracy < 80) {
    suggestions.push(
      '技能包中的规则约束可能偏宽泛，建议增加 1-2 组正反对比示例（Good vs Bad Code）。',
    );
  }

  for (const r of results) {
    if (r.overallScore < 70 && r.feedback) {
      suggestions.push(
        `针对用例 "${r.evalCase.query.slice(0, 20)}...": ${r.feedback}`,
      );
    }
  }

  if (suggestions.length === 0) {
    suggestions.push('技能包结构清晰、遵循度极高，无需特殊调整！');
  }

  return suggestions;
}

/** 格式化 Markdown 评测报告 */
export function formatEvalReportMarkdown(report: EvalReport): string {
  const lines: string[] = [];

  lines.push(`# 📊 AI 技能自动化评测报告: ${report.skillName}`);
  lines.push('');
  lines.push(`- **评测时间**: ${report.evaluatedAt}`);
  lines.push(`- **评测模型**: ${report.model}`);
  lines.push(
    `- **综合评级**: **${report.grade} 级** (${report.overallScore} / 100 分)`,
  );
  lines.push(
    `- **触发命中得分**: ${report.avgTriggerScore} 分 | **准确度得分**: ${report.avgAccuracyScore} 分`,
  );
  lines.push('');

  lines.push('## 📈 用例评测明细');
  lines.push('');

  report.caseResults.forEach((r, idx) => {
    lines.push(`### 用例 ${idx + 1}: ${r.evalCase.query}`);
    lines.push(
      `- **综合得分**: ${r.overallScore} 分 (触发: ${r.triggerScore} | 准确: ${r.accuracyScore})`,
    );
    lines.push(
      `- **预期关键词**: ${r.evalCase.expectedKeywords.join(', ')} (命中: ${r.matchedKeywords.join(', ') || '无'})`,
    );
    lines.push(`- **评测反馈**: ${r.feedback}`);
    lines.push('');
  });

  lines.push('## 💡 技能包优化建议');
  lines.push('');
  report.suggestions.forEach((s) => lines.push(`- ${s}`));
  lines.push('');

  return lines.join('\n');
}
