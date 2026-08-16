import OpenAI from 'openai';
import type { LLMConfig } from '../types/index.js';
import { warn } from '../utils/logger.js';
import {
  ResourceLimitError,
  abortableSleep,
  createAbortScope,
  throwIfAborted,
  toAbortError,
} from '../utils/abort.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
export const DEFAULT_LLM_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_MAX_OUTPUT_CHARS = 1024 * 1024;
const DEFAULT_SYSTEM_PROMPT =
  'You are a technical documentation analyst. You extract structured, actionable knowledge from raw documents and format it as AI Agent skill instructions. Always respond in the SAME language as the source document. Output ONLY the skill file content, no preamble or explanation.';

export interface CallLLMOptions {
  /** 覆盖默认的“文档提炼”系统提示词，供搜索解释、评测等不同角色使用。 */
  systemPrompt?: string;
  /** 覆盖 LLMConfig.temperature。 */
  temperature?: number;
  /** 上游取消信号。 */
  signal?: AbortSignal;
  /** 整次调用（含重试）的超时，默认 120 秒。 */
  timeoutMs?: number;
  /** 响应文本字符上限，默认 1 MiB。 */
  maxOutputChars?: number;
}

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

/**
 * 统一 LLM 调用层
 * 兼容所有 OpenAI 协议兼容的 API：OpenAI / DeepSeek / 火山方舟 Ark / 本地模型
 * 内置指数退避重试：限流/服务端/网络错误最多重试 3 次（1s → 2s → 4s）
 */
export async function callLLM(
  prompt: string,
  config: LLMConfig,
  options: CallLLMOptions = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  if (!Number.isSafeInteger(maxOutputChars) || maxOutputChars < 1) {
    throw new RangeError('maxOutputChars 必须是正整数');
  }
  const maxOutputTokens = config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  if (
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1 ||
    maxOutputTokens > 131_072
  ) {
    throw new RangeError('maxOutputTokens 必须是 1-131072 的整数');
  }

  const scope = createAbortScope(options.signal, timeoutMs, 'LLM 调用');
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    maxRetries: 0, // 关闭 SDK 内置重试，由本层统一控制
  });

  let lastError: unknown;
  try {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        throwIfAborted(scope.signal, 'LLM 调用');
        const res = await client.chat.completions.create(
          {
            model: config.model,
            messages: [
              {
                role: 'system',
                content: options.systemPrompt || DEFAULT_SYSTEM_PROMPT,
              },
              { role: 'user', content: prompt },
            ],
            temperature: options.temperature ?? config.temperature ?? 0.3,
            // max_tokens 是 DeepSeek、Ark 与多数本地 OpenAI 兼容服务的共同参数。
            max_tokens: maxOutputTokens,
          },
          { signal: scope.signal },
        );

        const content = extractContent(res);
        if (!content) {
          throw new Error(
            'LLM 返回空内容或格式异常（返回片段: ' +
              JSON.stringify(res).slice(0, 300) +
              '）',
          );
        }
        const normalized = content.trim();
        if (normalized.length > maxOutputChars) {
          throw new ResourceLimitError(
            `LLM 响应超过 ${maxOutputChars} 字符限制`,
          );
        }
        return normalized;
      } catch (err: unknown) {
        if (scope.signal.aborted) {
          throw toAbortError(scope.signal.reason, 'LLM 调用已取消');
        }
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        // 空内容与资源上限错误不重试（重试无益）
        const retryable =
          !(err instanceof ResourceLimitError) && isRetryableError(err);
        if (!retryable || attempt === MAX_RETRIES) {
          throw err;
        }
        const delay = BASE_DELAY_MS * 2 ** attempt;
        warn(
          `LLM 调用失败（${message}），${delay / 1000}s 后重试 (${attempt + 1}/${MAX_RETRIES})...`,
        );
        await abortableSleep(delay, scope.signal);
      }
    }
    throw lastError;
  } finally {
    scope.dispose();
  }
}

/**
 * 从 LLM 响应中提取文本内容，兼容多种返回格式
 *
 * 标准 OpenAI: { choices: [{ message: { content: "..." } }] }
 * 变体1:       { choices: [{ text: "..." }] }              (旧版 completions)
 * 变体2:       { message: { content: "..." } }              (部分本地服务)
 * 变体3:       { content: "..." }                           (简化格式)
 * 变体4:       { data: { content: "..." } }                 (自定义封装)
 * 变体5:       直接返回字符串
 */
function extractContent(res: any): string | null {
  if (!res) return null;

  // 直接返回字符串
  if (typeof res === 'string') return res;

  // 标准 OpenAI 格式: choices[0].message.content
  if (res.choices?.[0]?.message?.content) {
    return res.choices[0].message.content;
  }

  // 旧版 completions 格式: choices[0].text
  if (res.choices?.[0]?.text) {
    return res.choices[0].text;
  }

  // 直接 message.content（部分本地服务）
  if (res.message?.content) {
    return res.message.content;
  }

  // 直接 content 字段
  if (typeof res.content === 'string') {
    return res.content;
  }

  // data.content 封装
  if (res.data?.content) {
    return res.data.content;
  }

  // data.message.content 封装
  if (res.data?.message?.content) {
    return res.data.message.content;
  }

  // 最后兜底：尝试 res.response / res.output 等
  if (res.response?.choices?.[0]?.message?.content) {
    return res.response.choices[0].message.content;
  }

  if (res.output) {
    if (typeof res.output === 'string') return res.output;
    if (Array.isArray(res.output)) {
      // 可能是 output 数组，拼接文本
      return res.output
        .map((item: any) =>
          typeof item === 'string' ? item : item?.content || item?.text || '',
        )
        .filter(Boolean)
        .join('\n');
    }
  }

  return null;
}
