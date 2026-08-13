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

const REDUCTION_INPUT_CHARS = 48_000;
const DEFAULT_CONCURRENCY = 3;

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

  if (chunks.length <= 1) {
    stats.llmCalls++;
    return {
      content: await callLLM(
        buildPrompt(doc, agentType, name, template),
        config,
      ),
      stats,
    };
  }

  const concurrency = normalizeConcurrency(options.concurrency);
  let notes = await mapWithConcurrency(chunks, concurrency, async (chunk) => {
    stats.llmCalls++;
    return callLLM(
      buildChunkExtractionPrompt(
        doc,
        chunk.content,
        chunk.index,
        chunks.length,
        agentType,
      ),
      config,
    );
  });

  while (combinedLength(notes) > REDUCTION_INPUT_CHARS && notes.length > 1) {
    stats.reductionPasses++;
    const batches = packNotes(notes, REDUCTION_INPUT_CHARS);
    notes = await mapWithConcurrency(batches, concurrency, async (batch) => {
      stats.llmCalls++;
      return callLLM(
        buildReductionPrompt(batch, stats.reductionPasses),
        config,
      );
    });
  }

  stats.llmCalls++;
  const content = await callLLM(
    buildSynthesisPrompt(doc, notes, agentType, name, template),
    config,
  );
  return { content, stats };
}

function normalizeConcurrency(value?: number): number {
  return Number.isSafeInteger(value) && value! > 0
    ? Math.min(value!, 8)
    : DEFAULT_CONCURRENCY;
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
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

export { buildPrompt, callLLM, splitDocument, DEFAULT_CHUNK_CHARS };
