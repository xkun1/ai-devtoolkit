/**
 * 配置文件加载器
 * 查找顺序：CLI 参数 > 项目根目录 .devtoolkit.json > ~/.devtoolkit.json > 默认值
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentType, OutputMode } from './types/index.js';

export interface DevToolkitConfig {
  /** 默认 Agent 类型 */
  type?: AgentType;
  /** 默认输出路径 */
  out?: string;
  /** 默认模型 */
  model?: string;
  /** 默认技能名 */
  name?: string;
  /** 默认 Base URL */
  baseUrl?: string;
  /** 默认 API Key（不安全，建议用环境变量） */
  apiKey?: string;
  /** 是否 verbose */
  verbose?: boolean;
  /** 模板 ID */
  template?: string;
  /** 输出结构：modern（默认）或 legacy。 */
  outputMode?: OutputMode;
  /** 单次 LLM 调用超时毫秒数。 */
  llmTimeoutMs?: number;
  /** 单次模型响应 Token 上限。 */
  maxOutputTokens?: number;
  /** 目录批处理并发数。 */
  batchConcurrency?: number;
  /** 目录批处理文件数上限。 */
  maxBatchFiles?: number;
}

const CONFIG_FILES = [
  '.devtoolkit.json',
  '.devtoolkitrc',
  '.devtoolkitrc.json',
];

/**
 * 从配置文件读取默认值
 * 查找位置：当前目录 → 向上递归到根目录 → 用户主目录
 */
export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<DevToolkitConfig> {
  // 1. 项目目录链
  let dir = cwd;
  const dirs: string[] = [];
  while (true) {
    dirs.push(dir);
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  // 2. 用户主目录
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (home && !dirs.includes(home)) dirs.push(home);

  // 从近到远查找，找到第一个就返回
  for (const d of dirs) {
    for (const filename of CONFIG_FILES) {
      const filepath = join(d, filename);
      if (existsSync(filepath)) {
        try {
          const raw = await readFile(filepath, 'utf-8');
          const parsed = JSON.parse(raw);
          return validateConfig(parsed, filepath);
        } catch (err: any) {
          throw new Error(`配置文件解析失败 ${filepath}: ${err.message}`, {
            cause: err,
          });
        }
      }
    }
  }

  return {};
}

/** 校验配置对象，忽略不认识的字段 */
function validateConfig(raw: any, filepath: string): DevToolkitConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`配置文件 ${filepath} 顶层必须是 JSON 对象`);
  }
  const config: DevToolkitConfig = {};
  const validKeys: (keyof DevToolkitConfig)[] = [
    'type',
    'out',
    'model',
    'name',
    'baseUrl',
    'apiKey',
    'verbose',
    'template',
    'outputMode',
    'llmTimeoutMs',
    'maxOutputTokens',
    'batchConcurrency',
    'maxBatchFiles',
  ];

  for (const key of validKeys) {
    if (key in raw) {
      (config as any)[key] = raw[key];
    }
  }

  // 校验 type
  if (config.type && !['codex', 'cursor', 'claude'].includes(config.type)) {
    throw new Error(
      `配置文件 ${filepath} 中 type 无效: ${config.type}（可选: codex, cursor, claude）`,
    );
  }

  const stringKeys: (keyof DevToolkitConfig)[] = [
    'out',
    'model',
    'name',
    'baseUrl',
    'apiKey',
    'template',
  ];
  for (const key of stringKeys) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      throw new Error(`配置文件 ${filepath} 中 ${key} 必须是字符串`);
    }
  }
  if (config.verbose !== undefined && typeof config.verbose !== 'boolean') {
    throw new Error(`配置文件 ${filepath} 中 verbose 必须是布尔值`);
  }
  if (
    config.outputMode !== undefined &&
    typeof config.outputMode !== 'string'
  ) {
    throw new Error(`配置文件 ${filepath} 中 outputMode 必须是字符串`);
  }
  if (
    config.outputMode !== undefined &&
    !['modern', 'legacy'].includes(config.outputMode)
  ) {
    throw new Error(
      `配置文件 ${filepath} 中 outputMode 无效（可选: modern, legacy）`,
    );
  }

  for (const [key, minimum, maximum] of [
    ['llmTimeoutMs', 1_000, 600_000],
    ['maxOutputTokens', 1, 131_072],
    ['batchConcurrency', 1, 8],
    ['maxBatchFiles', 1, 10_000],
  ] as const) {
    const value = config[key];
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    ) {
      throw new Error(
        `配置文件 ${filepath} 中 ${key} 必须是 ${minimum}-${maximum} 的整数`,
      );
    }
  }

  return config;
}
