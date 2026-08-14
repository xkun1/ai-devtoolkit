/**
 * 本地 Web UI 服务器
 *
 * 零依赖内嵌 HTTP 服务器（不依赖 express），
 * 提供单页 Web 界面让用户在浏览器中转化技能包。
 */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { Server } from 'node:http';
import type { AgentType } from './types/index.js';
import { isValidAgentType } from './format/index.js';
import { randomBytes } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { runPipeline } from './pipeline.js';
import { extractFromHtml } from './loader/readability.js';
import { isValidTemplate, listTemplates } from './templates/index.js';
import {
  MODEL_DISPLAY,
  detectLocalModels,
  isLocalModel,
  resolveModel,
} from './models.js';
import { estimateTokens } from './utils/token.js';
import { fetchPublicText, SafeFetchError } from './utils/safe-fetch.js';
import { WEB_UI_HTML } from './server/html.js';
import { createArtifactZip } from './utils/zip.js';
import { DownloadStore } from './utils/download-store.js';

import {
  convertRule,
  parseRule,
  discoverProjectRules,
  syncProjectRules,
} from './convert/index.js';
import { runSkillEval, formatEvalReportMarkdown } from './eval/index.js';
import {
  buildDependencyGraph,
  analyzeImpact,
  generateMermaidGraph,
  formatImpactReport,
} from './graph/index.js';
import {
  initCodeIndex,
  searchProjectCode,
  explainResults,
} from './search/index.js';
import {
  detectEnvironment,
  diffEnvironment,
  formatDiffPreview,
} from './env/index.js';
export { WEB_UI_HTML } from './server/html.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  /** 最大请求体字节数，默认 10 MiB。 */
  maxBodyBytes?: number;
  /** 最大远程文档字节数，默认 5 MiB。 */
  maxRemoteBytes?: number;
  /** 最大并发生成数，默认 2。 */
  maxConcurrentGenerations?: number;
  /** 仅测试使用：显式固定会话令牌。 */
  sessionToken?: string;
  /** ZIP 下载票据有效期，默认 10 分钟。 */
  downloadTtlMs?: number;
  /** Web UI 允许访问的项目根目录，默认启动进程的当前目录。 */
  projectRoot?: string;
  /** 源码查看器单文件读取上限，默认 2 MiB。 */
  maxReadableFileBytes?: number;
}

/** 创建 Web UI 请求处理器，供 startServer 或直接测试复用 */
export function createRequestHandler(options: ServerOptions = {}) {
  const port = options.port ?? 3456;
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Web UI 端口必须在 0-65535 之间');
  }
  const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024;
  const maxRemoteBytes = options.maxRemoteBytes ?? 5 * 1024 * 1024;
  const maxConcurrentGenerations = options.maxConcurrentGenerations ?? 2;
  const maxReadableFileBytes = options.maxReadableFileBytes ?? 2 * 1024 * 1024;
  const projectRoot = realpathSync(
    resolve(options.projectRoot ?? process.cwd()),
  );
  if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes < 1) {
    throw new Error('maxBodyBytes 必须是正整数');
  }
  if (!Number.isSafeInteger(maxRemoteBytes) || maxRemoteBytes < 1) {
    throw new Error('maxRemoteBytes 必须是正整数');
  }
  if (
    !Number.isSafeInteger(maxConcurrentGenerations) ||
    maxConcurrentGenerations < 1
  ) {
    throw new Error('maxConcurrentGenerations 必须是正整数');
  }
  if (!Number.isSafeInteger(maxReadableFileBytes) || maxReadableFileBytes < 1) {
    throw new Error('maxReadableFileBytes 必须是正整数');
  }
  const sessionToken = options.sessionToken || randomBytes(24).toString('hex');
  let actualPort = port;
  let activeGenerations = 0;
  const downloads = new DownloadStore({ ttlMs: options.downloadTtlMs });
  const defaultLLM = {
    apiKey: options.apiKey || '',
    baseURL: options.baseURL,
    model: options.model || 'deepseek-chat',
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      applySecurityHeaders(res, sessionToken);
      const requestOrigin = getAllowedOrigin(req, actualPort);
      if (!requestOrigin) {
        serveJSON(res, 403, { error: '拒绝非本机来源请求' });
        return;
      }

      const url = new URL(req.url || '/', requestOrigin);

      // ─── 路由 ───
      if (url.pathname === '/' && req.method === 'GET') {
        serveHTML(res, sessionToken);
        return;
      }

      if (url.pathname === '/api/templates' && req.method === 'GET') {
        serveJSON(res, 200, { templates: listTemplates() });
        return;
      }

      if (url.pathname === '/api/models' && req.method === 'GET') {
        serveJSON(res, 200, {
          models: MODEL_DISPLAY,
          defaultModel: defaultLLM.model,
          hasApiKey: !!defaultLLM.apiKey,
        });
        return;
      }

      // 探测本地模型服务
      if (url.pathname === '/api/local-models' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleLocalModels(req, res, maxBodyBytes);
        return;
      }

      if (url.pathname === '/api/generate' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        if (activeGenerations >= maxConcurrentGenerations) {
          serveJSON(res, 429, { error: '生成任务过多，请稍后重试' });
          return;
        }
        activeGenerations++;
        try {
          await handleGenerate(
            req,
            res,
            defaultLLM,
            maxBodyBytes,
            maxRemoteBytes,
            downloads,
          );
        } finally {
          activeGenerations--;
        }
        return;
      }

      if (url.pathname.startsWith('/api/download/') && req.method === 'GET') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        const id = url.pathname.slice('/api/download/'.length);
        if (!/^[a-zA-Z0-9_-]{32}$/.test(id)) {
          serveJSON(res, 404, { error: '下载不存在' });
          return;
        }
        const ticket = downloads.get(id);
        if (!ticket) {
          serveJSON(res, 404, { error: '下载已失效，请重新生成技能包' });
          return;
        }
        serveZip(res, ticket.buffer, ticket.filename);
        return;
      }

      if (url.pathname === '/api/estimate' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleEstimate(req, res, maxBodyBytes);
        return;
      }

      // ─── 代码搜索 API ───
      if (url.pathname === '/api/search' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleSearch(req, res, defaultLLM, maxBodyBytes, projectRoot);
        return;
      }

      if (url.pathname === '/api/search/index' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleSearchIndex(req, res, maxBodyBytes, projectRoot);
        return;
      }

      // ─── 环境资产 API ───
      if (
        url.pathname === '/api/env/detect' &&
        (req.method === 'GET' || req.method === 'POST')
      ) {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleEnvDetect(req, res);
        return;
      }

      if (url.pathname === '/api/env/diff' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleEnvDiff(req, res, maxBodyBytes);
        return;
      }

      // ─── 规则互转与同步 API ───
      if (url.pathname === '/api/convert' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleConvert(req, res, maxBodyBytes);
        return;
      }

      if (
        url.pathname === '/api/sync/discover' &&
        (req.method === 'GET' || req.method === 'POST')
      ) {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleSyncDiscover(req, res, maxBodyBytes, projectRoot);
        return;
      }

      if (url.pathname === '/api/sync' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleSync(req, res, maxBodyBytes, projectRoot);
        return;
      }

      // ─── 技能效果评测 API ───
      if (url.pathname === '/api/eval' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleEval(req, res, defaultLLM, maxBodyBytes);
        return;
      }

      // ─── 代码依赖图谱与影响面 API ───
      if (
        url.pathname === '/api/graph' &&
        (req.method === 'GET' || req.method === 'POST')
      ) {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleGraph(req, res, maxBodyBytes, projectRoot);
        return;
      }

      if (url.pathname === '/api/impact' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleImpact(req, res, maxBodyBytes, projectRoot);
        return;
      }

      if (url.pathname === '/api/file/read' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleReadFile(
          req,
          res,
          maxBodyBytes,
          projectRoot,
          maxReadableFileBytes,
        );
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (err: unknown) {
      const status =
        err instanceof HttpError || err instanceof SafeFetchError
          ? err.status
          : 500;
      serveJSON(res, status, { error: getErrorMessage(err) });
    }
  };

  return {
    handler,
    sessionToken,
    downloads,
    setActualPort: (p: number) => {
      actualPort = p;
    },
  };
}

/** 启动 Web UI 服务器 */
export function startServer(options: ServerOptions = {}): Server {
  const host = options.host ?? '127.0.0.1';
  if (!isLoopbackHost(host)) {
    throw new Error('Web UI 仅允许监听本机回环地址');
  }
  const port = options.port ?? 3456;
  const { handler, downloads, setActualPort } = createRequestHandler(options);
  let actualPort = port;
  const server = createServer(handler);

  server.headersTimeout = 30_000;
  server.requestTimeout = 5 * 60_000;
  server.keepAliveTimeout = 5_000;
  server.once('close', () => downloads.clear());

  server.listen(port, host, () => {
    const address = server.address();
    actualPort =
      typeof address === 'object' && address ? address.port : actualPort;
    setActualPort(actualPort);
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  🌐 devtoolkit Web UI                     ║`);
  });
  // 延迟输出 URL，确保 listen 回调先执行
  setTimeout(() => {
    console.log(`  ║                                          ║`);
    console.log(`  ║  浏览器打开: http://${host}:${actualPort}       `);
    console.log(`  ║                                          ║`);
    console.log(`  ║  Ctrl+C 退出                              `);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  }, 100);

  return server;
}

// ─── 请求处理 ───

/** 探测本地模型服务，返回可用模型列表 */
async function handleLocalModels(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
): Promise<void> {
  const body = await readBody(req, maxBodyBytes);
  const { baseUrl } = body;
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    serveJSON(res, 400, { error: '缺少 baseUrl 参数' });
    return;
  }
  try {
    const safeBaseUrl = validateLocalServiceUrl(baseUrl);
    const models = await detectLocalModels(safeBaseUrl);
    serveJSON(res, 200, { models, count: models.length });
  } catch (err: unknown) {
    const status = err instanceof HttpError ? err.status : 500;
    serveJSON(res, status, { error: getErrorMessage(err) });
  }
}

async function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
  maxBodyBytes: number,
  maxRemoteBytes: number,
  downloads: DownloadStore,
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
    const llmConfig = resolveModel(modelName || defaultLLM.model, {
      apiKey: apiKey || defaultLLM.apiKey,
      baseUrl: safeBaseUrl,
      localModelName,
    });

    // 所有 Web 输入都转成预加载内容，杜绝 pipeline 读取服务端本地路径。
    let preloadedContent = fileContent || '';
    let preloadedFileName = fileName || 'uploaded';
    let preloadedSource = fileName || 'file-upload';
    let preloadedBinary = binaryContent || undefined;
    let preloadedMime = mimeType || undefined;

    if (!hasFileContent) {
      const remote = await fetchPublicText(String(source), {
        maxBytes: maxRemoteBytes,
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

async function handleEstimate(
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

function serveHTML(res: ServerResponse, sessionToken: string): void {
  const safeToken = sessionToken.replace(/[^a-zA-Z0-9_-]/g, '');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(
    WEB_UI_HTML.replace(
      '<head>',
      `<head>\n<meta name="devtoolkit-session" content="${safeToken}">`,
    )
      .replaceAll('__SESSION_TOKEN__', safeToken)
      .replaceAll('__DOC2SKILL_NONCE__', safeToken),
  );
}

function serveJSON(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveZip(res: ServerResponse, buffer: Buffer, filename: string): void {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${safeFilename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

/** 读取 JSON 请求体
 *
 * 使用 Buffer 拼接而非 string +=，避免大文档跨 chunk 时的多字节字符截断。
 */
async function readBody(req: IncomingMessage, limit: number): Promise<any> {
  const buffer = await readRequestBuffer(req, limit);
  const data = buffer.toString('utf-8');
  if (!data) return {};
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, '请求体必须是 JSON 对象');
    }
    return parsed;
  } catch {
    throw new HttpError(400, '请求体必须是合法 JSON 对象');
  }
}

/**
 * 解析 multipart/form-data 请求体（用于文件上传）
 * 零依赖手动解析 boundary 分隔的表单数据
 */
async function readMultipartBody(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, string>> {
  const buffer = await readRequestBuffer(req, limit);
  return new Promise((resolve, reject) => {
    try {
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        resolve({});
        return;
      }
      const boundary = Buffer.from(`--${boundaryMatch[1].trim()}`);
      const result: Record<string, string> = {};

      // 用 Buffer.indexOf 手动分割（Buffer 没有 split 方法）
      let offset = 0;
      let sepIndex: number;
      const headerSep = Buffer.from('\r\n\r\n');

      while ((sepIndex = buffer.indexOf(boundary, offset)) !== -1) {
        const partStart = sepIndex + boundary.length;
        // 跳过 boundary 后的 \r\n
        const contentStart =
          partStart + 2 <= buffer.length &&
          buffer[partStart] === 0x0d &&
          buffer[partStart + 1] === 0x0a
            ? partStart + 2
            : partStart;

        // 找下一个 boundary
        const nextSep = buffer.indexOf(boundary, contentStart);
        if (nextSep === -1) break;

        // 当前 part 内容（去掉末尾 \r\n）
        let partBuf = buffer.subarray(contentStart, nextSep);
        if (partBuf.length >= 2 && partBuf[partBuf.length - 2] === 0x0d) {
          partBuf = partBuf.subarray(0, partBuf.length - 2);
        }

        // 找 header/content 分隔
        const headerEnd = partBuf.indexOf(headerSep);
        if (headerEnd === -1) {
          offset = nextSep;
          continue;
        }

        const headerStr = partBuf.subarray(0, headerEnd).toString('utf-8');
        const contentBuf = partBuf.subarray(headerEnd + headerSep.length);

        // 提取字段名
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        if (!nameMatch) {
          offset = nextSep;
          continue;
        }
        const fieldName = nameMatch[1];

        // 提取文件名（如果有）
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          const fname = filenameMatch[1].toLowerCase();
          const isBinary =
            fname.endsWith('.pdf') ||
            fname.endsWith('.docx') ||
            fname.endsWith('.doc');
          if (isBinary) {
            // 二进制文件用 base64 编码存储，避免 utf-8 转换损坏
            result['binaryContent'] = contentBuf.toString('base64');
            result['mimeType'] = fname.endsWith('.pdf')
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          } else {
            result['fileContent'] = contentBuf.toString('utf-8');
          }
          result['fileName'] = filenameMatch[1];
        } else {
          result[fieldName] = contentBuf.toString('utf-8');
        }

        offset = nextSep;
      }

      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

function readRequestBuffer(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) {
      fail(new HttpError(400, 'Content-Length 无效'));
      return;
    }
    if (declaredLength > limit) {
      fail(new HttpError(413, `请求体超过 ${formatBytes(limit)} 限制`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        fail(new HttpError(413, `请求体超过 ${formatBytes(limit)} 限制`));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(400, '请求被中止')));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function applySecurityHeaders(res: ServerResponse, scriptNonce: string): void {
  const safeNonce = scriptNonce.replace(/[^a-zA-Z0-9_-]/g, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${safeNonce}'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  );
}

function getAllowedOrigin(req: IncomingMessage, port: number): string | null {
  const hostHeader = req.headers.host;
  if (!hostHeader) return null;
  const parsedHost = parseHostHeader(hostHeader);
  if (!parsedHost) return null;
  const { hostname, port: requestPort } = parsedHost;
  if (!isLoopbackHost(hostname)) return null;
  if (requestPort !== port) return null;
  const expectedOrigin = `http://${hostHeader}`;
  const origin = req.headers.origin;
  if (origin && origin !== expectedOrigin) return null;
  return expectedOrigin;
}

function parseHostHeader(
  value: string,
): { hostname: string; port: number } | null {
  try {
    const url = new URL(`http://${value}`);
    return {
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : 80,
    };
  } catch {
    return null;
  }
}

function hasValidSession(req: IncomingMessage, token: string): boolean {
  return req.headers['x-devtoolkit-token'] === token;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  );
}

function validateLocalServiceUrl(value: unknown): string {
  const url = parseUrl(value, '本地模型地址');
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    throw new HttpError(
      400,
      '本地模型地址仅允许 http://localhost/127.0.0.1/::1',
    );
  }
  if (url.username || url.password) {
    throw new HttpError(400, '本地模型地址不允许包含认证信息');
  }
  return url.href.replace(/\/$/, '');
}

/** 模型探测允许根地址；OpenAI Chat Completions 调用必须以 /v1 为基址。 */
function toOpenAICompatibleBaseUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') url.pathname = '/v1';
  return url.href.replace(/\/$/, '');
}

function resolveWebModelBaseUrl(
  model: string,
  requestedBaseUrl: string | undefined,
  defaultBaseUrl: string | undefined,
): string | undefined {
  if (isLocalModel(model)) {
    if (requestedBaseUrl) {
      return toOpenAICompatibleBaseUrl(
        validateLocalServiceUrl(requestedBaseUrl),
      );
    }
    if (defaultBaseUrl) {
      try {
        return toOpenAICompatibleBaseUrl(
          validateLocalServiceUrl(defaultBaseUrl),
        );
      } catch {
        // 默认配置可能属于云端模型；此时回退到本地模型自身预设。
      }
    }
    return undefined;
  }

  if (requestedBaseUrl && requestedBaseUrl !== defaultBaseUrl) {
    throw new HttpError(400, 'Web UI 不允许覆盖云端模型服务地址');
  }
  return defaultBaseUrl;
}

async function resolveProjectPath(
  projectRoot: string,
  requestedPath?: unknown,
): Promise<string> {
  if (requestedPath !== undefined && typeof requestedPath !== 'string') {
    throw new HttpError(400, '项目路径必须是字符串');
  }
  const requested = requestedPath?.trim() || '.';
  if (requested.length > 10_000 || requested.includes('\0')) {
    throw new HttpError(400, '项目路径无效');
  }
  const candidate = resolve(projectRoot, requested);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(candidate);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new HttpError(404, `路径不存在: ${requested}`);
    }
    throw err;
  }

  const rel = relative(projectRoot, canonicalPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HttpError(403, '禁止访问项目根目录之外的路径');
  }
  return canonicalPath;
}

function parseUrl(value: unknown, label: string): URL {
  try {
    return new URL(String(value));
  } catch {
    throw new HttpError(400, `${label} 格式无效`);
  }
}

function validateGenerateInput(input: {
  agentType?: unknown;
  template?: unknown;
  modelName?: unknown;
  localModelName?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
}): void {
  if (
    input.agentType !== undefined &&
    !['codex', 'cursor', 'claude'].includes(String(input.agentType))
  ) {
    throw new HttpError(400, '无效的 Agent 类型');
  }
  if (
    input.template !== undefined &&
    input.template !== '' &&
    !isValidTemplate(String(input.template))
  ) {
    throw new HttpError(400, '未知模板');
  }
  for (const [label, value] of [
    ['模型名', input.modelName],
    ['本地模型名', input.localModelName],
  ] as const) {
    if (value !== undefined && String(value).length > 200) {
      throw new HttpError(400, `${label}过长`);
    }
  }
  if (input.fileName !== undefined) {
    const name = String(input.fileName);
    if (name.length > 255 || /[\\/\0]/.test(name)) {
      throw new HttpError(400, '上传文件名无效');
    }
    if (
      !/\.(md|markdown|txt|text|html?|pdf|docx|json|ya?ml|xml|csv)$/i.test(name)
    ) {
      throw new HttpError(400, '不支持的上传文件类型');
    }
  }
  if (input.mimeType !== undefined && String(input.mimeType).length > 200) {
    throw new HttpError(400, 'MIME 类型无效');
  }
}

function formatBytes(value: number): string {
  return `${Math.ceil(value / 1024 / 1024)} MiB`;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── 代码搜索与环境资产处理函数 ───

async function handleSearch(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
  maxBodyBytes: number,
  projectRoot: string,
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
        const llmConfig = resolveModel(model, {
          apiKey,
          baseUrl: baseURL,
          localModelName,
        });
        explanation = await explainResults({
          llm: llmConfig,
          query,
          results,
          projectRoot: index.projectRoot,
        });
      } catch (err: any) {
        if (err instanceof HttpError) throw err;
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

async function handleSearchIndex(
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

async function handleEnvDetect(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const snapshot = await detectEnvironment();
  serveJSON(res, 200, { snapshot });
}

async function handleEnvDiff(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    snapshot?: any;
  };
  if (!body.snapshot || typeof body.snapshot !== 'object') {
    throw new HttpError(400, '缺少快照数据');
  }
  let diff: Awaited<ReturnType<typeof diffEnvironment>>;
  try {
    diff = await diffEnvironment(body.snapshot);
  } catch (err) {
    throw new HttpError(400, `环境快照无效: ${getErrorMessage(err)}`);
  }
  serveJSON(res, 200, {
    diff,
    preview: formatDiffPreview(diff),
  });
}

// ─── 规则互转、技能评测、依赖图谱 API 处理函数 ───

async function handleConvert(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    content?: string;
    to?: AgentType;
    name?: string;
  };
  if (
    typeof body.content !== 'string' ||
    !body.content.trim() ||
    typeof body.to !== 'string'
  ) {
    throw new HttpError(400, '缺少 content 或 to 参数');
  }
  if (body.content.length > 1024 * 1024) {
    throw new HttpError(413, '规则内容超过 1 MiB 限制');
  }
  if (!isValidAgentType(String(body.to))) {
    throw new HttpError(400, '无效的目标 Agent 类型');
  }
  if (
    body.name !== undefined &&
    (typeof body.name !== 'string' || body.name.length > 200)
  ) {
    throw new HttpError(400, '规则名称无效或过长');
  }
  const parsed = parseRule(body.content);
  const result = convertRule(parsed, { to: body.to, name: body.name });
  serveJSON(res, 200, {
    success: true,
    from: result.from,
    to: result.to,
    artifacts: result.artifacts,
    preview: result.artifacts[0]?.content || '',
  });
}

async function handleSyncDiscover(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body =
    req.method === 'POST'
      ? ((await readBody(req, maxBodyBytes)) as { projectRoot?: string })
      : {};
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const discovered = await discoverProjectRules(root);
  serveJSON(res, 200, {
    projectRoot: root,
    discovered,
    totalFiles: discovered.reduce((acc, d) => acc + d.files.length, 0),
  });
}

async function handleSync(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    projectRoot?: string;
    from?: AgentType | 'auto';
    to?: AgentType[];
    dryRun?: boolean;
  };
  if (
    body.from !== undefined &&
    !['auto', 'codex', 'cursor', 'claude'].includes(String(body.from))
  ) {
    throw new HttpError(400, '无效的同步源 Agent 类型');
  }
  if (
    body.to !== undefined &&
    (!Array.isArray(body.to) ||
      body.to.length > 3 ||
      body.to.some((agent) => !isValidAgentType(String(agent))))
  ) {
    throw new HttpError(400, '无效的同步目标 Agent 列表');
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    throw new HttpError(400, 'dryRun 必须是布尔值');
  }
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const result = await syncProjectRules({
    projectRoot: root,
    from: body.from,
    to: body.to,
    dryRun: body.dryRun ?? true,
  });
  serveJSON(res, 200, result);
}

async function handleEval(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
  maxBodyBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    skillContent?: string;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    localModelName?: string;
  };
  if (typeof body.skillContent !== 'string' || !body.skillContent.trim()) {
    throw new HttpError(400, '缺少 skillContent 参数');
  }
  if (body.skillContent.length > 1024 * 1024) {
    throw new HttpError(413, '技能内容超过 1 MiB 限制');
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

  const model = String(body.model || defaultLLM.model);
  const apiKey = body.apiKey || defaultLLM.apiKey;
  const localModelName = body.localModelName;
  const safeBaseUrl = resolveWebModelBaseUrl(
    model,
    body.baseURL,
    defaultLLM.baseURL,
  );

  let llmConfig: ReturnType<typeof resolveModel>;
  try {
    llmConfig = resolveModel(model, {
      apiKey,
      baseUrl: safeBaseUrl,
      localModelName,
    });
  } catch (err) {
    throw new HttpError(400, getErrorMessage(err));
  }

  const report = await runSkillEval(body.skillContent, { llm: llmConfig });
  serveJSON(res, 200, {
    report,
    markdown: formatEvalReportMarkdown(report),
  });
}

async function handleGraph(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body =
    req.method === 'POST'
      ? ((await readBody(req, maxBodyBytes)) as {
          projectRoot?: string;
          direction?: 'TD' | 'LR';
        })
      : {};
  if (body.direction !== undefined && !['TD', 'LR'].includes(body.direction)) {
    throw new HttpError(400, 'direction 仅支持 TD 或 LR');
  }
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const graph = await buildDependencyGraph({ root });
  const mermaid = generateMermaidGraph(graph, {
    direction: body.direction || 'LR',
  });
  serveJSON(res, 200, {
    graph,
    mermaid,
  });
}

async function handleImpact(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    targetFile?: string;
    projectRoot?: string;
  };
  if (typeof body.targetFile !== 'string' || !body.targetFile.trim()) {
    throw new HttpError(400, '缺少 targetFile 参数');
  }
  if (body.targetFile.length > 10_000) {
    throw new HttpError(400, 'targetFile 参数过长');
  }
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const graph = await buildDependencyGraph({ root });
  const result = analyzeImpact(graph, body.targetFile);
  serveJSON(res, 200, {
    result,
    report: formatImpactReport(result),
  });
}

async function handleReadFile(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
  maxReadableFileBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    path?: string;
  };
  if (typeof body.path !== 'string' || !body.path.trim()) {
    throw new HttpError(400, '缺少 path 参数');
  }
  const absPath = await resolveProjectPath(projectRoot, body.path);
  const fileStat = await stat(absPath);
  if (!fileStat.isFile()) {
    throw new HttpError(400, '仅允许读取普通文件');
  }
  if (fileStat.size > maxReadableFileBytes) {
    throw new HttpError(413, '文件超过源码查看大小限制');
  }
  const content = await readFile(absPath, 'utf-8');
  serveJSON(res, 200, {
    path: body.path,
    content,
    lines: content.split(String.fromCharCode(10)).length,
    size: fileStat.size,
  });
}
