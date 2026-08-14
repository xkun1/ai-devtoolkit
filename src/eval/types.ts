/**
 * 技能效果评测 (Skill Eval) 类型定义
 */
import type { LLMConfig } from '../types/index.js';

/** 单个评测用例 */
export interface EvalCase {
  id: string;
  /** 测试提示词 / 用户问题 */
  query: string;
  /** 期望触发的关键词 / 概念 */
  expectedKeywords: string[];
  /** 期望包含的核心结论 / 规则要点 */
  expectedConclusion: string;
  /** 评分参考准则 */
  rubric?: string;
}

/** 评测测试集 */
export interface EvalSuite {
  skillName: string;
  skillPath?: string;
  cases: EvalCase[];
  createdAt: number;
}

/** 单个用例的评测对照结果 */
export interface CaseEvalResult {
  evalCase: EvalCase;
  /** 带技能时的模型回答 */
  withSkillAnswer: string;
  /** 不带技能时的模型基线回答 */
  baselineAnswer: string;
  /** 触发命中率打分 (0-100) */
  triggerScore: number;
  /** 技能遵循度与准确率打分 (0-100) */
  accuracyScore: number;
  /** 无技能基线准确率打分 (0-100) */
  baselineAccuracyScore: number;
  /** 技能相对基线的准确率提升，可为负数 */
  improvementScore: number;
  /** 综合评分 (0-100) */
  overallScore: number;
  /** 评测分析与优化建议 */
  feedback: string;
  /** 匹配到的预期关键词 */
  matchedKeywords: string[];
}

/** 技能评测整体报告 */
export interface EvalReport {
  skillName: string;
  evaluatedAt: string;
  model: string;
  totalCases: number;
  /** 平均触发得分 (0-100) */
  avgTriggerScore: number;
  /** 平均准确得分 (0-100) */
  avgAccuracyScore: number;
  /** 平均无技能基线得分 (0-100) */
  avgBaselineScore: number;
  /** 平均技能增益，可为负数 */
  avgImprovementScore: number;
  /** 综合得分 (0-100) */
  overallScore: number;
  /** 评级：S / A / B / C / D */
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  /** 每个用例明细 */
  caseResults: CaseEvalResult[];
  /** 针对技能包编写的改进建议 */
  suggestions: string[];
}

/** 生成评测用例的选项 */
export interface GenerateEvalOptions {
  llm: LLMConfig;
  count?: number;
}

/** 运行评测的选项 */
export interface RunEvalOptions {
  llm: LLMConfig;
  /** 可选独立裁判模型；默认使用 llm。 */
  judgeLlm?: LLMConfig;
  suite?: EvalSuite;
  outputDir?: string;
  /** 用例并发数，默认 2，最大 4。 */
  concurrency?: number;
}
