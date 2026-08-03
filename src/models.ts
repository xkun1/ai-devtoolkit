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
  },
  'lmstudio-local': {
    baseURL: 'http://localhost:1234/v1',
    envVar: '_LOCAL',
    description: 'LM Studio 本地模型',
    local: true,
  },
  // 自定义本地模型：用户自行输入服务地址并选择模型
  'custom-local': {
    baseURL: '',
    envVar: '_LOCAL',
    description: '自定义本地模型服务（OpenAI 兼容 API）',
    local: true,
  },
};

/** 本地模型探测结果 */
export interface LocalModelInfo {
  id: string;
  name: string;
}

/** 模型展示项 */
export interface ModelDisplayItem {
  id: string;
  name: string;
  envVar: string;
  local?: boolean;
  /** 本地服务默认地址（用于前端预填提示） */
  defaultBaseUrl?: string;
}

/** 模型展示信息（用于 Wizard 和 Web UI 下拉列表） */
export const MODEL_DISPLAY: ModelDisplayItem[] = [
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
    defaultBaseUrl: 'http://localhost:11434',
  },
  {
    id: 'lmstudio-local',
    name: '🖥️ LM Studio 本地模型 (免费/离线)',
    envVar: '_LOCAL',
    local: true,
    defaultBaseUrl: 'http://localhost:1234',
  },
  {
    id: 'custom-local',
    name: '🔧 自定义本地模型 (填写服务地址)',
    envVar: '_LOCAL',
    local: true,
  },
];

/** 判断是否为本地模型 */
export function isLocalModel(modelId: string): boolean {
  return MODEL_PRESETS[modelId]?.local === true;
}

/** 解析模型配置：返回最终用于 LLM 调用的 config
 *
 * - localModelName：本地模型实际名称（由探测或手动输入），
 *   仅对 custom-local / ollama-local / lmstudio-local 有效
 * - baseUrl：覆盖预设中的 baseURL
 */
export function resolveModel(
  modelId: string,
  options?: {
    apiKey?: string;
    baseUrl?: string;
    localModelName?: string;
  },
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
      baseURL: options?.baseUrl || preset.baseURL || undefined,
      // 优先使用传入的实际模型名，其次从环境变量取
      model: options?.localModelName || process.env.LOCAL_MODEL_NAME || modelId,
    };
  }

  // 云端模型：需要 API Key
  const envVar = preset?.envVar || 'OPENAI_API_KEY';
  const apiKey =
    options?.apiKey || process.env[envVar] || process.env.OPENAI_API_KEY || '';
  const baseURL = options?.baseUrl || preset?.baseURL;

  return { apiKey, baseURL, model: modelId };
}

/**
 * 探测本地模型服务，返回可用模型列表
 *
 * 支持两种协议：
 * - OpenAI 兼容接口（/v1/models）：LM Studio / vLLM / Xinference 等
 * - Ollama 原生接口（/api/tags）
 *
 * 用户输入地址后自动尝试多种探测路径，取第一个成功的。
 */
export async function detectLocalModels(
  baseURL: string,
  timeoutMs = 5000,
): Promise<LocalModelInfo[]> {
  const base = (baseURL || '').trim().replace(/\/+$/, '');
  if (!base) return [];

  // 候选探测路径（按优先级排列）
  const candidates: string[] = [];
  if (/\/v1\/?$/i.test(base)) {
    // 地址已含 /v1，直接拼接 /models
    candidates.push(`${base}/models`);
  } else {
    candidates.push(`${base}/v1/models`);
    candidates.push(`${base}/models`);
  }
  // Ollama 原生接口兜底
  candidates.push(`${base}/api/tags`);

  for (const url of candidates) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) continue;
      const data: any = await res.json();

      const models = parseModelList(data);
      if (models.length > 0) return models;
    } catch {
      // 连接失败/超时，尝试下一个候选路径
    }
  }

  return [];
}

/**
 * 解析模型列表响应，兼容多种格式：
 * - OpenAI:  { data: [{ id }] }
 * - Ollama:  { models: [{ name }] }
 * - 数组:    ['model1', 'model2']
 * - result:  { result: ['model1'] }
 * - 单模型:  { model: 'xxx' } 或 { id: 'xxx' }
 */
function parseModelList(data: any): LocalModelInfo[] {
  if (!data) return [];

  // 直接数组
  if (Array.isArray(data)) {
    return data
      .map((m: any) =>
        typeof m === 'string'
          ? { id: m, name: m }
          : {
              id: String(m.id || m.name || m.model || ''),
              name: String(m.id || m.name || m.model || ''),
            },
      )
      .filter((m: LocalModelInfo) => m.id);
  }

  // OpenAI 格式: { data: [{ id }] }
  if (Array.isArray(data.data) && data.data.length > 0) {
    return data.data
      .map((m: any) => ({
        id: String(m.id || m.name || m.model || ''),
        name: String(m.id || m.name || m.model || ''),
      }))
      .filter((m: LocalModelInfo) => m.id);
  }

  // Ollama 格式: { models: [{ name }] }
  if (Array.isArray(data.models) && data.models.length > 0) {
    return data.models
      .map((m: any) => ({
        id: String(m.name || m.model || m.id || ''),
        name: String(m.name || m.model || m.id || ''),
      }))
      .filter((m: LocalModelInfo) => m.id);
  }

  // result 格式: { result: [...] }
  if (Array.isArray(data.result)) {
    return data.result
      .map((m: any) =>
        typeof m === 'string'
          ? { id: m, name: m }
          : {
              id: String(m.id || m.name || m.model || ''),
              name: String(m.id || m.name || m.model || ''),
            },
      )
      .filter((m: LocalModelInfo) => m.id);
  }

  // 单模型格式: { model: 'xxx' } 或 { id: 'xxx' }
  if (data.model || data.id) {
    const id = String(data.model || data.id || '');
    if (id) return [{ id, name: id }];
  }

  return [];
}
