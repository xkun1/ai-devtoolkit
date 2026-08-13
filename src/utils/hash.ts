/** 增量生成缓存：完整指纹、真实产物校验与原子持久化。 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import type {
  AgentType,
  GeneratedArtifact,
  GenerationStats,
  OutputMode,
  SkillResult,
} from '../types/index.js';

const CACHE_FILENAME = '.devtoolkit-cache.json';
const CACHE_VERSION = 2;

export interface FingerprintInput {
  source: string;
  content: string;
  agentType: AgentType | string;
  template?: string;
  model?: string;
  baseURL?: string;
  temperature?: number;
  maxOutputTokens?: number;
  name?: string;
  outputMode?: OutputMode;
  promptVersion?: string;
}

interface CachedArtifact {
  path: string;
  hash: string;
  kind: GeneratedArtifact['kind'];
}

interface CacheEntry {
  fingerprint: string;
  generatedAt: string;
  agentType: string;
  stats?: Omit<GenerationStats, 'cacheHit'>;
  artifacts: CachedArtifact[];
}

interface CacheFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

/** 计算文本内容的完整 SHA-256。 */
export function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** 获取缓存文件路径（基于输出文件所在目录）。 */
export function getCachePath(outputPath: string): string {
  return join(dirname(outputPath), CACHE_FILENAME);
}

/** 指纹覆盖源内容以及所有会影响输出的生成参数，不包含 API Key。 */
export function buildGenerationFingerprint(input: FingerprintInput): string {
  return contentHash(
    stableStringify({
      source: input.source,
      contentHash: contentHash(input.content),
      agentType: input.agentType,
      template: input.template ?? null,
      model: input.model ?? null,
      baseURL: normalizeBaseURL(input.baseURL),
      temperature: input.temperature ?? null,
      maxOutputTokens: input.maxOutputTokens ?? null,
      name: input.name ?? null,
      outputMode: input.outputMode ?? 'modern',
      promptVersion: input.promptVersion ?? null,
      generatorVersion: 'p1-v1',
    }),
  );
}

/**
 * 缓存命中时读取磁盘上的真实生成物；任一文件缺失或被修改都视为未命中。
 */
export function loadCachedResult(
  cachePath: string,
  cacheKey: string,
  fingerprint: string,
  agentType: AgentType,
): SkillResult | undefined {
  const cache = loadCacheSync(cachePath);
  const entry = cache.entries[cacheKey];
  if (
    !entry ||
    entry.fingerprint !== fingerprint ||
    entry.agentType !== agentType ||
    !entry.artifacts.length
  ) {
    return undefined;
  }

  const artifacts: GeneratedArtifact[] = [];
  for (const cached of entry.artifacts) {
    if (!existsSync(cached.path)) return undefined;
    try {
      const content = readFileSync(cached.path, 'utf-8');
      if (contentHash(content) !== cached.hash) return undefined;
      artifacts.push({ path: cached.path, content, kind: cached.kind });
    } catch {
      return undefined;
    }
  }

  const primary = artifacts[0];
  return {
    agentType,
    content: primary.content,
    suggestedPath: primary.path,
    artifacts,
    stats: entry.stats ? { ...entry.stats, cacheHit: true } : undefined,
  };
}

/** 记录生成结果。缓存最后落盘，确保不会指向尚未写完的文件。 */
export function saveGeneratedResult(
  cachePath: string,
  cacheKey: string,
  fingerprint: string,
  result: SkillResult,
): void {
  const cache = loadCacheSync(cachePath);
  const artifacts = result.artifacts ?? [
    {
      path: result.suggestedPath,
      content: result.content,
      kind: 'primary' as const,
    },
  ];
  cache.entries[cacheKey] = {
    fingerprint,
    generatedAt: new Date().toISOString(),
    agentType: result.agentType,
    stats: result.stats
      ? {
          sourceChars: result.stats.sourceChars,
          processedChars: result.stats.processedChars,
          sourceChunks: result.stats.sourceChunks,
          llmCalls: result.stats.llmCalls,
          reductionPasses: result.stats.reductionPasses,
        }
      : undefined,
    artifacts: artifacts.map((item) => ({
      path: item.path,
      hash: contentHash(item.content),
      kind: item.kind,
    })),
  };
  saveCacheSync(cachePath, cache);
}

/** 输出路径与来源共同组成稳定缓存键，避免同源多目标相互覆盖。 */
export function createCacheKey(source: string, outputPath: string): string {
  return `${contentHash(source).slice(0, 12)}:${contentHash(resolve(outputPath))}`;
}

/**
 * 旧版兼容 API。新代码应使用 buildGenerationFingerprint/loadCachedResult。
 */
export function needsUpdate(
  cachePath: string,
  source: string,
  content: string,
  agentType: string,
  template?: string,
): boolean {
  const cache = loadCacheSync(cachePath);
  const key = legacyKey(source);
  const fingerprint = legacyFingerprint(source, content, agentType, template);
  return cache.entries[key]?.fingerprint !== fingerprint;
}

/** 旧版兼容 API，仅记录指纹，不具备产物复用能力。 */
export function markGenerated(
  cachePath: string,
  source: string,
  content: string,
  agentType: string,
  template?: string,
): void {
  const cache = loadCacheSync(cachePath);
  cache.entries[legacyKey(source)] = {
    fingerprint: legacyFingerprint(source, content, agentType, template),
    generatedAt: new Date().toISOString(),
    agentType,
    artifacts: [],
  };
  saveCacheSync(cachePath, cache);
}

export function clearCacheEntry(cachePath: string, source: string): void {
  const cache = loadCacheSync(cachePath);
  delete cache.entries[legacyKey(source)];
  for (const key of Object.keys(cache.entries)) {
    if (key.startsWith(`${contentHash(source).slice(0, 12)}:`)) {
      delete cache.entries[key];
    }
  }
  saveCacheSync(cachePath, cache);
}

function loadCacheSync(cachePath: string): CacheFile {
  if (!existsSync(cachePath)) return emptyCache();
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as unknown;
    if (!isCacheFile(parsed)) return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

function saveCacheSync(cachePath: string, data: CacheFile): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
    renameSync(tempPath, cachePath);
  } finally {
    if (existsSync(tempPath)) unlinkSync(tempPath);
  }
}

function emptyCache(): CacheFile {
  return { version: CACHE_VERSION, entries: {} };
}

function isCacheFile(value: unknown): value is CacheFile {
  if (!value || typeof value !== 'object') return false;
  const data = value as Partial<CacheFile>;
  return (
    data.version === CACHE_VERSION &&
    !!data.entries &&
    typeof data.entries === 'object' &&
    !Array.isArray(data.entries)
  );
}

function normalizeBaseURL(baseURL?: string): string | null {
  return baseURL?.replace(/\/+$/, '') || null;
}

function stableStringify(value: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify(sorted);
}

function legacyKey(source: string): string {
  return `legacy:${contentHash(source)}`;
}

function legacyFingerprint(
  source: string,
  content: string,
  agentType: string,
  template?: string,
): string {
  return buildGenerationFingerprint({
    source,
    content,
    agentType,
    template,
    outputMode: 'legacy',
  });
}
