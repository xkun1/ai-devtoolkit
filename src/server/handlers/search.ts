import type { IncomingMessage, ServerResponse } from 'node:http';
import { isLocalModel, resolveModel } from '../../models.js';
import {
  initCodeIndex,
  searchProjectCode,
  explainResults,
} from '../../search/index.js';
import { HttpError, readBody, serveJSON } from '../http.js';
import { resolveProjectPath, resolveWebModelBaseUrl } from '../validation.js';
import type { ServerTaskLimits } from '../types.js';
import { ResourceLimitError, isAbortError } from '../../utils/abort.js';

export async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
  maxBodyBytes: number,
  projectRoot: string,
  limits: ServerTaskLimits,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    query?: string;
    directory?: string;
    limit?: number;
    explain?: boolean;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    localModelName?: string;
  };
  if (body.query !== undefined && typeof body.query !== 'string') {
    throw new HttpError(400, '搜索内容必须是字符串');
  }
  const query = body.query?.trim();
  if (!query) {
    throw new HttpError(400, '搜索内容不能为空');
  }
  if (query.length > 10_000) {
    throw new HttpError(400, '搜索内容过长');
  }
  for (const [label, value] of [
    ['model', body.model],
    ['apiKey', body.apiKey],
    ['baseURL', body.baseURL],
    ['localModelName', body.localModelName],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > 10_000)
    ) {
      throw new HttpError(400, `${label} 参数无效`);
    }
  }

  const directory = await resolveProjectPath(projectRoot, body.directory);
  const limit = body.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(400, 'limit 必须是 1-100 的整数');
  }
  if (body.explain !== undefined && typeof body.explain !== 'boolean') {
    throw new HttpError(400, 'explain 必须是布尔值');
  }
  const useExplain = body.explain ?? false;

  const { results, index } = await searchProjectCode(
    query,
    { limit },
    directory,
  );

  let explanation: string | undefined;
  if (useExplain && results.length > 0) {
    const model = body.model || defaultLLM.model;
    const apiKey = body.apiKey || defaultLLM.apiKey;
    const localModelName = body.localModelName;

    if (isLocalModel(model) || apiKey) {
      try {
        const baseURL = resolveWebModelBaseUrl(
          model,
          body.baseURL,
          defaultLLM.baseURL,
        );
        const llmConfig = {
          ...resolveModel(model, {
            apiKey,
            baseUrl: baseURL,
            localModelName,
          }),
          maxOutputTokens: limits.maxOutputTokens,
        };
        explanation = await explainResults({
          llm: llmConfig,
          query,
          results,
          projectRoot: index.projectRoot,
          signal: limits.signal,
          timeoutMs: limits.llmTimeoutMs,
          maxOutputChars: limits.maxOutputChars,
        });
      } catch (err: any) {
        if (err instanceof HttpError) throw err;
        if (isAbortError(err) || err instanceof ResourceLimitError) throw err;
        explanation = 'LLM 解释生成失败: ' + err.message;
      }
    }
  }

  serveJSON(res, 200, {
    query,
    totalMatches: results.length,
    stats: index.stats,
    explanation,
    results: results.map((r) => ({
      file: r.chunk.file,
      language: r.chunk.language,
      startLine: r.chunk.startLine,
      endLine: r.chunk.endLine,
      score: Number(r.score.toFixed(2)),
      matchedSymbols: r.matchedSymbols,
      matchedKeywords: r.matchedKeywords,
      content: r.chunk.content,
    })),
  });
}

export async function handleSearchIndex(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    directory?: string;
  };
  const directory = await resolveProjectPath(projectRoot, body.directory);
  const index = await initCodeIndex({ root: directory });
  serveJSON(res, 200, {
    success: true,
    directory,
    stats: index.stats,
  });
}
