/**
 * Token 估算与成本预估测试
 */
import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateCost,
  formatCost,
  getModelPricing,
} from '../src/utils/token.js';

describe('estimateTokens', () => {
  it('英文为主约 4 字符/token', () => {
    const text = 'This is a test of the token estimation function';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(20);
  });

  it('中文为主约 2 字符/token', () => {
    const text = '这是一个测试文本用于验证中文内容的 token 估算功能';
    const tokens = estimateTokens(text);
    expect(tokens).toBeGreaterThan(text.length / 3);
  });

  it('空字符串返回 0', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('长文本估算合理', () => {
    const text = 'a'.repeat(4000);
    expect(estimateTokens(text)).toBe(1000);
  });
});

describe('estimateCost', () => {
  it('已知模型返回费用', () => {
    const cost = estimateCost(1000, 500, 'deepseek-chat');
    expect(cost).not.toBeNull();
    expect(cost!.total).toBeGreaterThan(0);
  });

  it('GPT-4o 费用高于 deepseek', () => {
    const deepseek = estimateCost(1000, 500, 'deepseek-chat');
    const gpt4o = estimateCost(1000, 500, 'gpt-4o');
    expect(gpt4o!.total).toBeGreaterThan(deepseek!.total);
  });

  it('未知模型返回 null', () => {
    expect(estimateCost(1000, 500, 'unknown-model')).toBeNull();
  });
});

describe('formatCost', () => {
  it('大费用保留 3 位小数', () => {
    expect(formatCost(0.123)).toBe('$0.123');
  });

  it('小费用保留 4 位小数', () => {
    expect(formatCost(0.005)).toBe('$0.0050');
  });
});

describe('getModelPricing', () => {
  it('返回已知模型定价', () => {
    const p = getModelPricing('gpt-4o');
    expect(p).not.toBeNull();
    expect(p!.input).toBe(2.5);
  });

  it('未知模型返回 null', () => {
    expect(getModelPricing('nonexistent')).toBeNull();
  });
});
