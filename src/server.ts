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
import { randomBytes } from 'node:crypto';
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
        await handleSearch(req, res, defaultLLM, maxBodyBytes);
        return;
      }

      if (url.pathname === '/api/search/index' && req.method === 'POST') {
        if (!hasValidSession(req, sessionToken)) {
          serveJSON(res, 403, { error: '无效的 Web UI 会话' });
          return;
        }
        await handleSearchIndex(req, res, maxBodyBytes);
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
  if (!baseUrl) {
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
    const safeLocalBaseUrl = localBaseUrl
      ? toOpenAICompatibleBaseUrl(validateLocalServiceUrl(localBaseUrl))
      : undefined;
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
    if (selectedModel === 'custom-local' && !safeLocalBaseUrl) {
      throw new HttpError(400, 'custom-local 必须指定本地服务地址');
    }
    const llmConfig = resolveModel(modelName || defaultLLM.model, {
      apiKey: apiKey || defaultLLM.apiKey,
      baseUrl: safeLocalBaseUrl || defaultLLM.baseURL,
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
  if (!text) {
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
  return data ? JSON.parse(data) : {};
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
  const query = body.query?.trim();
  if (!query) {
    throw new HttpError(400, '搜索内容不能为空');
  }

  const directory = body.directory?.trim() || process.cwd();
  const limit = body.limit ?? 10;
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
    const baseURL = body.baseURL || defaultLLM.baseURL;
    const localModelName = body.localModelName;

    if (isLocalModel(model) || apiKey) {
      try {
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
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    directory?: string;
  };
  const directory = body.directory?.trim() || process.cwd();
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
  const diff = await diffEnvironment(body.snapshot);
  serveJSON(res, 200, {
    diff,
    preview: formatDiffPreview(diff),
  });
}
