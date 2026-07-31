/**
 * 增量更新：用文档内容 hash 检测变更
 *
 * 在 .doc2skill-cache.json 中记录每个 source 的 hash。
 * 如果 hash 未变，说明文档没有更新，可以跳过 LLM 调用。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const CACHE_FILENAME = '.doc2skill-cache.json';

interface CacheEntry {
  /** 文档内容的 hash */
  hash: string;
  /** 上次生成时间 */
  generatedAt: string;
  /** 使用过的模板 */
  template?: string;
  /** 使用的 Agent 类型 */
  agentType: string;
}

type CacheData = Record<string, CacheEntry>;

/** 计算文本内容的 hash */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/** 获取缓存文件路径（基于输出文件所在目录） */
export function getCachePath(outputPath: string): string {
  const dir = dirname(outputPath);
  return join(dir, CACHE_FILENAME);
}

/** 加载缓存（同步） */
function loadCacheSync(cachePath: string): CacheData {
  if (!existsSync(cachePath)) return {};
  try {
    const raw = readFileSync(cachePath, 'utf-8');
    return JSON.parse(raw) as CacheData;
  } catch {
    return {};
  }
}

/** 保存缓存（同步） */
function saveCacheSync(cachePath: string, data: CacheData): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(data, null, 2));
}

/**
 * 检查文档是否需要重新生成
 * @returns true = 需要更新（hash 变了或首次运行），false = 跳过（未变更）
 */
export function needsUpdate(
  cachePath: string,
  source: string,
  content: string,
  agentType: string,
  template?: string,
): boolean {
  const cache = loadCacheSync(cachePath);
  const hash = contentHash(content);
  const entry = cache[source];

  if (!entry) return true; // 首次运行
  if (entry.hash !== hash) return true; // 内容变更
  if (entry.agentType !== agentType) return true; // Agent 类型变了
  if (entry.template !== template) return true; // 模板变了

  return false;
}

/** 记录文档已生成（更新缓存） */
export function markGenerated(
  cachePath: string,
  source: string,
  content: string,
  agentType: string,
  template?: string,
): void {
  const cache = loadCacheSync(cachePath);
  cache[source] = {
    hash: contentHash(content),
    generatedAt: new Date().toISOString(),
    agentType,
    template,
  };
  saveCacheSync(cachePath, cache);
}

/** 清除某个来源的缓存 */
export function clearCacheEntry(cachePath: string, source: string): void {
  const cache = loadCacheSync(cachePath);
  delete cache[source];
  saveCacheSync(cachePath, cache);
}
