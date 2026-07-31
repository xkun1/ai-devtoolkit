/**
 * 统一模型预设注册表
 * 全局唯一数据源：CLI / Wizard / Web UI 共用
 */
import type { ModelPreset } from './types/index.js';

export const MODEL_PRESETS: Record<string, ModelPreset> = {
  'deepseek-chat': {
    baseURL: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek Chat',
  },
  'deepseek-reasoner': {
    baseURL: 'https://api.deepseek.com/v1',
    envVar: 'DEEPSEEK_API_KEY',
    description: 'DeepSeek Reasoner (R1)',
  },
  'gpt-4o': {
    baseURL: undefined,
    envVar: 'OPENAI_API_KEY',
    description: 'OpenAI GPT-4o',
  },
  'gpt-4o-mini': {
    baseURL: undefined,
    envVar: 'OPENAI_API_KEY',
    description: 'OpenAI GPT-4o-mini',
  },
  'doubao-pro-32k': {
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    envVar: 'ARK_API_KEY',
    description: '火山方舟 Doubao Pro',
  },
  // ─── 本地模型 ───
  'ollama-local': {
    baseURL: 'http://localhost:11434/v1',
    envVar: '_LOCAL',
    description: 'Ollama 本地模型',
    local: true,
    localModelEnv: 'OLLAMA_MODEL',
  },
  'lmstudio-local': {
    baseURL: 'http://localhost:1234/v1',
    envVar: '_LOCAL',
    description: 'LM Studio 本地模型',
    local: true,
    localModelEnv: 'LMSTUDIO_MODEL',
  },
};

/** 模型展示信息（用于 Wizard 和 Web UI 下拉列表） */
export const MODEL_DISPLAY: {
  id: string;
  name: string;
  envVar: string;
  local?: boolean;
}[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat (性价比之王)',
    envVar: 'DEEPSEEK_API_KEY',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek Reasoner (R1 推理)',
    envVar: 'DEEPSEEK_API_KEY',
  },
  { id: 'gpt-4o', name: 'GPT-4o (OpenAI 旗舰)', envVar: 'OPENAI_API_KEY' },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini (OpenAI 轻量)',
    envVar: 'OPENAI_API_KEY',
  },
  {
    id: 'doubao-pro-32k',
    name: 'Doubao Pro 32k (火山方舟)',
    envVar: 'ARK_API_KEY',
  },
  {
    id: 'ollama-local',
    name: '🦙 Ollama 本地模型 (免费/离线)',
    envVar: '_LOCAL',
    local: true,
  },
  {
    id: 'lmstudio-local',
    name: '🖥️ LM Studio 本地模型 (免费/离线)',
    envVar: '_LOCAL',
    local: true,
  },
];

/** 判断是否为本地模型 */
export function isLocalModel(modelId: string): boolean {
  return MODEL_PRESETS[modelId]?.local === true;
}

/** 解析本地模型实际名称 */
export function resolveLocalModelName(modelId: string): string {
  const preset = MODEL_PRESETS[modelId];
  if (!preset?.local) return modelId;

  // 优先从环境变量读取实际模型名（如 OLLAMA_MODEL=qwen2.5:7b）
  const envVar = preset.localModelEnv;
  if (envVar && process.env[envVar]) {
    return process.env[envVar]!;
  }

  // 本地模型默认名
  const defaults: Record<string, string> = {
    'ollama-local': 'qwen2.5:7b',
    'lmstudio-local': 'local-model',
  };
  return defaults[modelId] || 'local-model';
}

/** 解析模型配置：返回最终用于 LLM 调用的 config */
export function resolveModel(
  modelId: string,
  options?: { apiKey?: string; baseUrl?: string },
): {
  apiKey: string;
  baseURL?: string;
  model: string;
} {
  const preset = MODEL_PRESETS[modelId];

  if (preset?.local) {
    // 本地模型：不需要 API Key，用占位符
    return {
      apiKey: 'local-no-key',
      baseURL: options?.baseUrl || preset.baseURL,
      model: resolveLocalModelName(modelId),
    };
  }

  // 云端模型：需要 API Key
  const envVar = preset?.envVar || 'OPENAI_API_KEY';
  const apiKey =
    options?.apiKey || process.env[envVar] || process.env.OPENAI_API_KEY || '';
  const baseURL = options?.baseUrl || preset?.baseURL;

  return { apiKey, baseURL, model: modelId };
}
