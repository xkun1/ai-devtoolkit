/**
 * Token 估算与成本预估
 *
 * 使用启发式：英文 ~4 字符/token，中文 ~2 字符/token，混合取 3 字符/token
 */

/** 粗略估算文本的 token 数 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // 中文字符占比 → 影响估算
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const cjkRatio = cjk / text.length;

  if (cjkRatio > 0.3) {
    // 中文为主
    return Math.ceil(text.length / 2);
  }
  if (cjkRatio > 0.1) {
    // 混合
    return Math.ceil(text.length / 3);
  }
  // 英文为主
  return Math.ceil(text.length / 4);
}

/** 常见模型的单价（每 1M token，美元） */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek-chat': { input: 0.27, output: 1.1 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'doubao-pro-32k': { input: 0.8, output: 2 },
};

/** 获取模型定价，未知模型返回 null */
export function getModelPricing(
  model: string,
): { input: number; output: number } | null {
  return MODEL_PRICING[model] ?? null;
}

/** 预估费用（美元），返回 null 表示无法预估 */
export function estimateCost(
  inputTokens: number,
  estimatedOutputTokens: number,
  model: string,
): { inputCost: number; outputCost: number; total: number } | null {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.output;
  return {
    inputCost,
    outputCost,
    total: inputCost + outputCost,
  };
}

/** 格式化费用展示 */
export function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(3)}`;
}
