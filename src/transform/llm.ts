import OpenAI from 'openai';
import type { LLMConfig } from '../types/index.js';
import { warn } from '../utils/logger.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/** 判断错误是否可重试：429 限流 / 5xx 服务端错误 / 网络层错误 */
export function isRetryableError(err: any): boolean {
  // OpenAI SDK 的 APIError 带 status
  const status = err?.status ?? err?.response?.status;
  if (typeof status === 'number') {
    if (status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false; // 4xx 客户端错误（认证失败等）重试无意义
  }
  // 网络层错误（无 HTTP 状态码）
  const code = err?.code || '';
  const message = err?.message || '';
  return (
    ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND'].includes(
      code,
    ) || /fetch failed|network|socket hang up|timeout/i.test(message)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 统一 LLM 调用层
 * 兼容所有 OpenAI 协议兼容的 API：OpenAI / DeepSeek / 火山方舟 Ark / 本地模型
 * 内置指数退避重试：限流/服务端/网络错误最多重试 3 次（1s → 2s → 4s）
 */
export async function callLLM(
  prompt: string,
  config: LLMConfig,
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0, // 关闭 SDK 内置重试，由本层统一控制
  });

  let lastError: any;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.chat.completions.create({
        model: config.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a technical documentation analyst. You extract structured, actionable knowledge from raw documents and format it as AI Agent skill instructions. Always respond in the SAME language as the source document. Output ONLY the skill file content, no preamble or explanation.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: config.temperature ?? 0.3,
      });

      const content = res.choices[0]?.message?.content;
      if (!content) {
        throw new Error('LLM 返回空内容');
      }
      return content.trim();
    } catch (err: any) {
      lastError = err;
      // 空内容错误不重试（模型行为问题，重试无益）
      const retryable =
        err.message !== 'LLM 返回空内容' && isRetryableError(err);
      if (!retryable || attempt === MAX_RETRIES) {
        throw err;
      }
      const delay = BASE_DELAY_MS * 2 ** attempt;
      warn(
        `LLM 调用失败（${err.message}），${delay / 1000}s 后重试 (${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}
