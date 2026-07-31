import OpenAI from 'openai';
import type { LLMConfig } from '../types/index.js';

/**
 * 统一 LLM 调用层
 * 兼容所有 OpenAI 协议兼容的 API：OpenAI / DeepSeek / 火山方舟 Ark / 本地模型
 */
export async function callLLM(
  prompt: string,
  config: LLMConfig,
): Promise<string> {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

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
}
