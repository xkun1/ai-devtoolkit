/**
 * 技能评测用例生成器
 *
 * 基于技能包内容，利用 LLM 自动生成标准 Benchmark 测试集。
 */
import type { EvalCase, EvalSuite, GenerateEvalOptions } from './types.js';
import { callLLM } from '../transform/llm.js';
import { parseRule } from '../convert/parser.js';

/**
 * 为指定技能包自动生成评测用例集
 */
export async function generateEvalSuite(
  skillContent: string,
  options: GenerateEvalOptions,
  skillPath?: string,
): Promise<EvalSuite> {
  const parsed = parseRule(skillContent, skillPath);
  const skillName = parsed.meta.name || parsed.title || 'custom-skill';
  const count = options.count ?? 3;

  const prompt = `你是一个严苛的 AI 技能评测专家（Eval Benchmark Engineer）。
请仔细阅读以下 AI 技能包 / 规则内容，并为其设计 ${count} 个具有代表性的典型评测用例（Eval Cases）。

【评测用例设计要求】
1. query：开发者在实际编程场景中提出的具体问题或需求（应当能精确触发该技能中的具体规则，覆盖核心功能、边界条件或易错点）。
2. expectedKeywords：期望在符合该技能的回答中必须出现的 2~4 个关键专业词汇或 API 名。
3. expectedConclusion：该技能所规范的核心结论或正确处理方式（1-2 句话概括）。
4. rubric：用于衡量回答是否严格遵循技能规范的评分要点。

【技能包内容】
${skillContent}

【输出格式】
必须严格输出合法的 JSON 数组，格式如下（不要包含任何外部 markdown 标记）：
[
  {
    "id": "case_1",
    "query": "用户问题...",
    "expectedKeywords": ["关键词1", "关键词2"],
    "expectedConclusion": "期望的核心结论...",
    "rubric": "评分标准..."
  }
]`;

  try {
    const rawResponse = await callLLM(prompt, options.llm);
    const cleanJson = rawResponse
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();

    const cases = JSON.parse(cleanJson) as EvalCase[];
    return {
      skillName,
      skillPath,
      cases: Array.isArray(cases) ? cases.slice(0, count) : [],
      createdAt: Date.now(),
    };
  } catch {
    // LLM 解析失败或降级时的确定性兜底用例
    return {
      skillName,
      skillPath,
      cases: generateFallbackCases(parsed, count),
      createdAt: Date.now(),
    };
  }
}

/** 规则提取失败或本地纯静态模式下的兜底用例生成 */
export function generateFallbackCases(
  parsed: ReturnType<typeof parseRule>,
  count = 3,
): EvalCase[] {
  const title = parsed.title || parsed.meta.name || '核心规范';
  const desc = parsed.meta.description || '相关处理逻辑';

  const cases: EvalCase[] = [
    {
      id: 'case_1',
      query: `请说明如何使用并遵循 ${title} 进行开发？`,
      expectedKeywords: [title.slice(0, 10)],
      expectedConclusion: `应严格遵循 ${desc} 的指导原则。`,
      rubric: '回答是否准确提及该技能的核心原则与关键实践。',
    },
  ];

  if (count > 1) {
    cases.push({
      id: 'case_2',
      query: `在 ${title} 场景下，常见的边界条件和错误写法是什么？`,
      expectedKeywords: ['规范', '错误'],
      expectedConclusion: '指出常见反模式并给出符合技能要求的正确范例。',
      rubric: '是否清晰列举出技能中强调的限制或反模式。',
    });
  }

  if (count > 2) {
    cases.push({
      id: 'case_3',
      query: `请给出一个符合 ${title} 的完整代码实现示例。`,
      expectedKeywords: ['示例', '实现'],
      expectedConclusion: '给出可直接运行且完全遵守该规范的代码片段。',
      rubric: '代码是否符合技能中定义的结构与命名规范。',
    });
  }

  return cases;
}
