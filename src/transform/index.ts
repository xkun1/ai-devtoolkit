import type { LoadedDocument, LLMConfig, AgentType } from '../types/index.js';
import type { SkillTemplate } from '../templates/index.js';
import { callLLM } from './llm.js';
import { splitDocument, DEFAULT_CHUNK_CHARS } from './chunk.js';
import {
  buildPrompt,
  buildChunkExtractionPrompt,
  buildReductionPrompt,
  buildSynthesisPrompt,
} from './prompts.js';
import { ResourceLimitError, throwIfAborted } from '../utils/abort.js';

const REDUCTION_INPUT_CHARS = 48_000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_LLM_CALLS = 100;

export interface TransformResult {
  content: string;
  stats: {
    sourceChars: number;
    processedChars: number;
    sourceChunks: number;
    llmCalls: number;
    reductionPasses: number;
  };
}

export interface TransformOptions {
  chunkChars?: number;
  concurrency?: number;
  signal?: AbortSignal;
  llmTimeoutMs?: number;
  maxOutputChars?: number;
  maxLLMCalls?: number;
}

/** 用 LLM 将原始文档提炼为结构化技能知识 */
export async function transformToSkill(
  doc: LoadedDocument,
  config: LLMConfig,
  agentType: AgentType,
  name?: string,
  template?: SkillTemplate,
): Promise<string> {
  const result = await transformDocumentToSkill(
    doc,
    config,
    agentType,
    name,
    template,
  );
  return result.content;
}

/**
 * 短文档单次提炼；长文档执行“全量分块抽取 → 分层归并 → 最终合成”。
 */
export async function transformDocumentToSkill(
  doc: LoadedDocument,
  config: LLMConfig,
  agentType: AgentType,
  name?: string,
  template?: SkillTemplate,
  options: TransformOptions = {},
): Promise<TransformResult> {
  throwIfAborted(options.signal, '技能提炼');
  const maxLLMCalls = normalizeMaxLLMCalls(options.maxLLMCalls);
  const chunks = splitDocument(
    doc.content,
    options.chunkChars ?? DEFAULT_CHUNK_CHARS,
  );
  const stats = {
    sourceChars: doc.content.length,
    processedChars: chunks.reduce(
      (sum, chunk) => sum + chunk.content.length,
      0,
    ),
    sourceChunks: chunks.length,
    llmCalls: 0,
    reductionPasses: 0,
  };

  const invokeLLM = async (prompt: string): Promise<string> => {
    throwIfAborted(options.signal, '技能提炼');
    if (stats.llmCalls >= maxLLMCalls) {
      throw new ResourceLimitError(
        `技能提炼超过 ${maxLLMCalls} 次 LLM 调用限制`,
      );
    }
    stats.llmCalls++;
    return callLLM(prompt, config, {
      signal: options.signal,
      timeoutMs: options.llmTimeoutMs,
      maxOutputChars: options.maxOutputChars,
    });
  };

  if (chunks.length <= 1) {
    return {
      content: await invokeLLM(buildPrompt(doc, agentType, name, template)),
      stats,
    };
  }

  const concurrency = normalizeConcurrency(options.concurrency);
  let notes = await mapWithConcurrency(
    chunks,
    concurrency,
    async (chunk) =>
      invokeLLM(
        buildChunkExtractionPrompt(
          doc,
          chunk.content,
          chunk.index,
          chunks.length,
          agentType,
        ),
      ),
    options.signal,
  );

  while (combinedLength(notes) > REDUCTION_INPUT_CHARS && notes.length > 1) {
    throwIfAborted(options.signal, '技能提炼');
    stats.reductionPasses++;
    const batches = packNotes(notes, REDUCTION_INPUT_CHARS);
    notes = await mapWithConcurrency(
      batches,
      concurrency,
      async (batch) =>
        invokeLLM(buildReductionPrompt(batch, stats.reductionPasses)),
      options.signal,
    );
  }

  const content = await invokeLLM(
    buildSynthesisPrompt(doc, notes, agentType, name, template),
  );
  return { content, stats };
}

function normalizeConcurrency(value?: number): number {
  return Number.isSafeInteger(value) && value! > 0
    ? Math.min(value!, 8)
    : DEFAULT_CONCURRENCY;
}

function normalizeMaxLLMCalls(value?: number): number {
  const normalized = value ?? DEFAULT_MAX_LLM_CALLS;
  if (
    !Number.isSafeInteger(normalized) ||
    normalized < 1 ||
    normalized > 10_000
  ) {
    throw new RangeError('maxLLMCalls 必须是 1-10000 的整数');
  }
  return normalized;
}

function combinedLength(items: string[]): number {
  return items.reduce((sum, item) => sum + item.length, 0);
}

function packNotes(notes: string[], limit: number): string[][] {
  const batches: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const note of notes) {
    if (current.length && size + note.length > limit) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(note);
    size += note.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      throwIfAborted(signal, '并发提炼');
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  const rejected = settled.find(
    (item): item is PromiseRejectedResult => item.status === 'rejected',
  );
  if (rejected) throw rejected.reason;
  return results;
}

export { buildPrompt, callLLM, splitDocument, DEFAULT_CHUNK_CHARS };
