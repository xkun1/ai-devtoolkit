import { beforeEach, describe, it, expect, vi } from 'vitest';

const mockCallLLM = vi.hoisted(() => vi.fn());
vi.mock('../src/transform/llm.js', () => ({ callLLM: mockCallLLM }));
import {
  generateEvalSuite,
  generateFallbackCases,
  runSkillEval,
  formatEvalReportMarkdown,
} from '../src/eval/index.js';
import { parseRule } from '../src/convert/parser.js';

const MOCK_SKILL = `---
name: stripe-payment-guide
description: "Stripe 支付集成规范"
---

# Stripe 支付规范

1. 创建付款意图时使用 PaymentIntents API。
2. 捕获 Webhook 事件并验证签名 stripe-signature。
3. 禁止在前端硬编码 secret_key。
`;

const MOCK_LLM = {
  model: 'mock-eval-model',
  apiKey: 'test-key',
};

beforeEach(() => {
  mockCallLLM.mockReset();
});

describe('技能效果评测 — 用例生成 (generator)', () => {
  it('generateFallbackCases 能确定性生成有效测试集', () => {
    const parsed = parseRule(MOCK_SKILL);
    const cases = generateFallbackCases(parsed, 3);

    expect(cases.length).toBe(3);
    expect(cases[0].query).toContain('Stripe');
    expect(cases[0].expectedKeywords.length).toBeGreaterThan(0);
    expect(cases[0].expectedConclusion).toBeDefined();
  });

  it('generateEvalSuite 在 LLM 异常时优雅降级并输出可用 Suite', async () => {
    mockCallLLM.mockRejectedValueOnce(new Error('mock unavailable'));
    const suite = await generateEvalSuite(MOCK_SKILL, {
      llm: MOCK_LLM,
      count: 2,
    });
    expect(suite.skillName).toBe('stripe-payment-guide');
    expect(suite.cases.length).toBeGreaterThanOrEqual(2);
    expect(suite.cases[0].query).toBeDefined();
  });

  it('拒绝异常用例数量并过滤无效 LLM 输出', async () => {
    await expect(
      generateEvalSuite(MOCK_SKILL, { llm: MOCK_LLM, count: 0 }),
    ).rejects.toThrow('1-10');

    mockCallLLM.mockResolvedValueOnce(
      JSON.stringify([
        { query: '', expectedKeywords: [], expectedConclusion: '' },
      ]),
    );
    const suite = await generateEvalSuite(MOCK_SKILL, {
      llm: MOCK_LLM,
      count: 4,
    });
    expect(suite.cases).toHaveLength(4);
  });
});

describe('技能效果评测 — 评测执行与报告 (runner)', () => {
  it('runSkillEval 完成对照打分并生成结构化报告', async () => {
    mockCallLLM.mockImplementation(
      async (
        prompt: string,
        _llm: unknown,
        options?: { systemPrompt?: string },
      ) => {
        if (options?.systemPrompt?.includes('评测裁判')) {
          expect(prompt).toContain('<with_skill_answer>');
          expect(prompt).toContain('<baseline_answer>');
          expect(prompt).toContain('普通基线回答');
          return JSON.stringify({
            triggerScore: 120,
            accuracyScore: 95,
            baselineAccuracyScore: -8,
            feedback: '技能回答明确覆盖签名验证。',
          });
        }
        if (options?.systemPrompt?.includes('<skill_rules>')) {
          return '使用 PaymentIntents，并验证 stripe-signature。';
        }
        return '普通基线回答';
      },
    );

    const report = await runSkillEval(MOCK_SKILL, {
      llm: MOCK_LLM,
      suite: {
        skillName: 'stripe-payment-guide',
        createdAt: Date.now(),
        cases: [
          {
            id: 'c1',
            query: '如何安全接收 Stripe Webhook？',
            expectedKeywords: ['PaymentIntents', 'stripe-signature'],
            expectedConclusion: '验证签名并在后端处理',
          },
        ],
      },
    });

    expect(report.skillName).toBe('stripe-payment-guide');
    expect(report.totalCases).toBe(1);
    expect(report.overallScore).toBeGreaterThanOrEqual(0);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(report.grade);
    expect(report.caseResults[0].evalCase.id).toBe('c1');
    expect(report.caseResults[0].triggerScore).toBe(100);
    expect(report.caseResults[0].accuracyScore).toBe(95);
    expect(report.caseResults[0].baselineAccuracyScore).toBe(0);
    expect(report.caseResults[0].improvementScore).toBe(95);
    expect(report.avgBaselineScore).toBe(0);
    expect(report.avgImprovementScore).toBe(95);
    expect(mockCallLLM).toHaveBeenCalledTimes(3);

    const markdown = formatEvalReportMarkdown(report);
    expect(markdown).toContain('# 📊 AI 技能自动化评测报告');
    expect(markdown).toContain('stripe-payment-guide');
    expect(markdown).toContain('评测反馈');
    expect(markdown).toContain('无技能基线');
    expect(markdown).toContain('+95');
  });

  it('LLM 全部失败时使用可解释的确定性降级评分', async () => {
    mockCallLLM.mockRejectedValue(new Error('offline'));
    const report = await runSkillEval(MOCK_SKILL, {
      llm: MOCK_LLM,
      suite: {
        skillName: 'stripe-payment-guide',
        createdAt: Date.now(),
        cases: [
          {
            id: 'offline',
            query: '如何处理？',
            expectedKeywords: ['stripe-signature'],
            expectedConclusion: '验证签名',
          },
        ],
      },
    });
    expect(report.caseResults[0]).toEqual(
      expect.objectContaining({
        triggerScore: 0,
        accuracyScore: 0,
        baselineAccuracyScore: 0,
        improvementScore: 0,
      }),
    );
  });

  it('取消信号不会被降级逻辑吞掉', async () => {
    const controller = new AbortController();
    controller.abort(new Error('停止评测'));
    await expect(
      runSkillEval(MOCK_SKILL, {
        llm: MOCK_LLM,
        signal: controller.signal,
      }),
    ).rejects.toThrow('停止评测');
    expect(mockCallLLM).not.toHaveBeenCalled();
  });

  it('严格执行评测 LLM 调用预算', async () => {
    mockCallLLM.mockResolvedValue('普通回答');
    await expect(
      runSkillEval(MOCK_SKILL, {
        llm: MOCK_LLM,
        maxLLMCalls: 2,
        suite: {
          skillName: 'budget',
          createdAt: Date.now(),
          cases: [
            {
              id: 'budget-1',
              query: '如何处理？',
              expectedKeywords: ['签名'],
              expectedConclusion: '验证签名',
            },
          ],
        },
      }),
    ).rejects.toThrow('2 次 LLM 调用');
    expect(mockCallLLM).toHaveBeenCalledTimes(2);
  });
});
