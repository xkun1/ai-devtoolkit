import { describe, it, expect } from 'vitest';
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
    const suite = await generateEvalSuite(MOCK_SKILL, {
      llm: MOCK_LLM,
      count: 2,
    });
    expect(suite.skillName).toBe('stripe-payment-guide');
    expect(suite.cases.length).toBeGreaterThanOrEqual(2);
    expect(suite.cases[0].query).toBeDefined();
  });
});

describe('技能效果评测 — 评测执行与报告 (runner)', () => {
  it('runSkillEval 完成对照打分并生成结构化报告', async () => {
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

    const markdown = formatEvalReportMarkdown(report);
    expect(markdown).toContain('# 📊 AI 技能自动化评测报告');
    expect(markdown).toContain('stripe-payment-guide');
    expect(markdown).toContain('评测反馈');
  });
});
