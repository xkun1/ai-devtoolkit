/**
 * 配置文件加载器
 * 查找顺序：CLI 参数 > 项目根目录 .doc2skill.json > ~/.doc2skill.json > 默认值
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentType } from './types/index.js';

export interface Doc2SkillConfig {
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
}

const CONFIG_FILES = ['.doc2skill.json', '.doc2skillrc', '.doc2skillrc.json'];

/**
 * 从配置文件读取默认值
 * 查找位置：当前目录 → 向上递归到根目录 → 用户主目录
 */
export async function loadConfig(
  cwd: string = process.cwd(),
): Promise<Doc2SkillConfig> {
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
function validateConfig(raw: any, filepath: string): Doc2SkillConfig {
  const config: Doc2SkillConfig = {};
  const validKeys: (keyof Doc2SkillConfig)[] = [
    'type',
    'out',
    'model',
    'name',
    'baseUrl',
    'apiKey',
    'verbose',
    'template',
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

  return config;
}
