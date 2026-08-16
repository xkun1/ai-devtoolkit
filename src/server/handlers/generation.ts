import type { IncomingMessage, ServerResponse } from 'node:http';
import { detectLocalModels, isLocalModel, resolveModel } from '../../models.js';
import { runPipeline } from '../../pipeline.js';
import { extractFromHtml } from '../../loader/readability.js';
import { estimateTokens } from '../../utils/token.js';
import { fetchPublicText, SafeFetchError } from '../../utils/safe-fetch.js';
import { createArtifactZip } from '../../utils/zip.js';
import { DownloadStore } from '../../utils/download-store.js';
import {
  HttpError,
  getErrorMessage,
  readBody,
  readMultipartBody,
  serveJSON,
} from '../http.js';
import {
  resolveWebModelBaseUrl,
  validateGenerateInput,
  validateLocalServiceUrl,
} from '../validation.js';
import type { ServerTaskLimits } from '../types.js';
import { ResourceLimitError, isAbortError } from '../../utils/abort.js';

export async function handleLocalModels(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  limits?: ServerTaskLimits,
): Promise<void> {
  const body = await readBody(req, maxBodyBytes);
  const { baseUrl } = body;
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    serveJSON(res, 400, { error: '缺少 baseUrl 参数' });
    return;
  }
  try {
    const safeBaseUrl = validateLocalServiceUrl(baseUrl);
    const models = await detectLocalModels(safeBaseUrl, 5000, limits?.signal);
    serveJSON(res, 200, { models, count: models.length });
  } catch (err: unknown) {
    if (isAbortError(err) || err instanceof ResourceLimitError) throw err;
    const status = err instanceof HttpError ? err.status : 500;
    serveJSON(res, status, { error: getErrorMessage(err) });
  }
}

export async function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
  maxBodyBytes: number,
  maxRemoteBytes: number,
  downloads: DownloadStore,
  limits: ServerTaskLimits,
): Promise<void> {
  const contentType = req.headers['content-type'] || '';

  let body: any;
  if (contentType.includes('multipart/form-data')) {
    body = await readMultipartBody(req, maxBodyBytes);
  } else {
    body = await readBody(req, maxBodyBytes);
  }

  const {
    source,
    agentType,
    template,
    modelName,
    apiKey,
    skillName,
    localBaseUrl,
    localModelName,
    fileContent,
    fileName,
    binaryContent,
    mimeType,
  } = body;

  for (const [label, value, maxLength] of [
    ['source', source, 10_000],
    ['agentType', agentType, 100],
    ['template', template, 100],
    ['modelName', modelName, 200],
    ['apiKey', apiKey, 10_000],
    ['skillName', skillName, 200],
    ['localBaseUrl', localBaseUrl, 10_000],
    ['localModelName', localModelName, 200],
    ['fileContent', fileContent, maxBodyBytes],
    ['fileName', fileName, 255],
    ['binaryContent', binaryContent, maxBodyBytes],
    ['mimeType', mimeType, 200],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > maxLength)
    ) {
      throw new HttpError(400, `${label} 参数无效`);
    }
  }

  // Web UI 不允许读取服务端本地路径，只接受 HTTP(S) URL 或浏览器上传内容。
  const hasUrl = source && source.trim().length > 0;
  const hasFileContent =
    (fileContent && fileContent.trim().length > 0) ||
    (binaryContent && binaryContent.length > 0);

  if (!hasUrl && !hasFileContent) {
    serveJSON(res, 400, { error: '缺少文档来源（HTTP(S) URL 或上传文件）' });
    return;
  }

  try {
    validateGenerateInput({
      agentType,
      template,
      modelName,
      localModelName,
      fileName,
      mimeType,
    });
    const selectedModel = String(modelName || defaultLLM.model);
    if (!isLocalModel(selectedModel) && localBaseUrl) {
      throw new HttpError(400, '云端模型不能使用 localBaseUrl');
    }
    if (isLocalModel(selectedModel) && !localModelName) {
      throw new HttpError(400, '缺少本地模型名');
    }
    const safeBaseUrl = resolveWebModelBaseUrl(
      selectedModel,
      localBaseUrl,
      defaultLLM.baseURL,
    );
    if (selectedModel === 'custom-local' && !safeBaseUrl) {
      throw new HttpError(400, 'custom-local 必须指定本地服务地址');
    }
    const llmConfig = {
      ...resolveModel(modelName || defaultLLM.model, {
        apiKey: apiKey || defaultLLM.apiKey,
        baseUrl: safeBaseUrl,
        localModelName,
      }),
      maxOutputTokens: limits.maxOutputTokens,
    };

    // 所有 Web 输入都转成预加载内容，杜绝 pipeline 读取服务端本地路径。
    let preloadedContent = fileContent || '';
    let preloadedFileName = fileName || 'uploaded';
    let preloadedSource = fileName || 'file-upload';
    let preloadedBinary = binaryContent || undefined;
    let preloadedMime = mimeType || undefined;

    if (!hasFileContent) {
      const remote = await fetchPublicText(String(source), {
        maxBytes: maxRemoteBytes,
        signal: limits.signal,
      });
      const isHtml = /text\/html|application\/xhtml\+xml/i.test(
        remote.contentType,
      );
      if (isHtml) {
        const extracted = await extractFromHtml(remote.body);
        preloadedContent = extracted.content;
        preloadedFileName =
          extracted.title || new URL(remote.finalUrl).hostname;
      } else {
        preloadedContent = remote.body;
        preloadedFileName =
          new URL(remote.finalUrl).pathname.split('/').pop() ||
          'remote-document';
      }
      preloadedSource = remote.finalUrl;
      preloadedBinary = undefined;
      preloadedMime = remote.contentType;
    }

    const result = await runPipeline('__preloaded__', {
      agentType: agentType || 'codex',
      llm: llmConfig,
      name: (skillName || fileName || '').replace(/\.[^.]+$/, '') || undefined,
      stdout: false,
      dryRun: true, // 不写文件，直接返回内容
      force: false,
      crawl: false,
      incremental: false,
      template: template || undefined,
      preloaded: {
        content: preloadedContent,
        binaryContent: preloadedBinary,
        mimeType: preloadedMime,
        fileName: preloadedFileName,
        source: preloadedSource,
      },
      signal: limits.signal,
      llmTimeoutMs: limits.llmTimeoutMs,
      maxOutputChars: limits.maxOutputChars,
    });

    const zip = await serializeZip(result, downloads);
    serveJSON(res, 200, {
      content: result.content,
      agentType: result.agentType,
      suggestedPath: result.suggestedPath,
      size: result.content.length,
      artifacts: result.artifacts,
      stats: result.stats,
      quality: result.quality,
      zip,
    });
  } catch (err: unknown) {
    if (isAbortError(err) || err instanceof ResourceLimitError) throw err;
    const status =
      err instanceof HttpError || err instanceof SafeFetchError
        ? err.status
        : 500;
    serveJSON(res, status, { error: getErrorMessage(err) });
  }
}

async function serializeZip(
  result: Awaited<ReturnType<typeof runPipeline>>,
  downloads: DownloadStore,
) {
  const artifacts = result.artifacts ?? [
    {
      path: result.suggestedPath,
      content: result.content,
      kind: 'primary' as const,
    },
  ];
  const ticket = downloads.add(
    await createArtifactZip(artifacts, result.agentType),
  );
  return {
    filename: ticket.filename,
    id: ticket.id,
    size: ticket.buffer.length,
    entries: ticket.entries,
    expiresAt: new Date(ticket.expiresAt).toISOString(),
  };
}

export async function handleEstimate(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
): Promise<void> {
  const body = await readBody(req, maxBodyBytes);
  const { text } = body;
  if (typeof text !== 'string' || !text) {
    serveJSON(res, 400, { error: '缺少 text 参数' });
    return;
  }
  serveJSON(res, 200, { tokens: estimateTokens(text) });
}

// ─── 工具函数 ───
