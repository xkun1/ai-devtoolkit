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
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { listTemplates } from './templates/index.js';
import { MODEL_DISPLAY } from './models.js';
import { SafeFetchError } from './utils/safe-fetch.js';
import { DownloadStore } from './utils/download-store.js';
import {
  HttpError,
  applySecurityHeaders,
  getAllowedOrigin,
  getErrorMessage,
  hasValidSession,
  isLoopbackHost,
  serveHTML,
  serveJSON,
  serveZip,
} from './server/http.js';
import {
  handleEstimate,
  handleGenerate,
  handleLocalModels,
} from './server/handlers/generation.js';
import { handleSearch, handleSearchIndex } from './server/handlers/search.js';
import {
  handleConvert,
  handleEnvDetect,
  handleEnvDiff,
  handleEval,
  handleSync,
  handleSyncDiscover,
} from './server/handlers/operations.js';
import {
  handleGraph,
  handleImpact,
  handleReadFile,
} from './server/handlers/graph.js';
import type { ServerTaskLimits } from './server/types.js';
import {
  DEFAULT_LLM_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_CHARS,
  DEFAULT_MAX_OUTPUT_TOKENS,
} from './transform/llm.js';
import {
  OperationTimeoutError,
  ResourceLimitError,
  createAbortScope,
  isAbortError,
} from './utils/abort.js';
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
  /** 单个 HTTP 请求总超时，默认 5 分钟。 */
  requestTimeoutMs?: number;
  /** 单次 LLM 调用超时，默认 120 秒。 */
  llmTimeoutMs?: number;
  /** 单次 LLM 响应字符上限，默认 1 MiB。 */
  maxOutputChars?: number;
  /** 单次模型响应最大 Token 数，默认 8192。 */
  maxOutputTokens?: number;
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
  const requestTimeoutMs = options.requestTimeoutMs ?? 5 * 60_000;
  const llmTimeoutMs = options.llmTimeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const maxOutputChars = options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
  const maxOutputTokens = options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
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
  validateLimit(requestTimeoutMs, 1, 60 * 60_000, 'requestTimeoutMs');
  validateLimit(llmTimeoutMs, 1, 10 * 60_000, 'llmTimeoutMs');
  validateLimit(maxOutputChars, 1, 10 * 1024 * 1024, 'maxOutputChars');
  validateLimit(maxOutputTokens, 1, 131_072, 'maxOutputTokens');
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
    const requestController = new AbortController();
    const onAborted = () => {
      // 真实 HTTP 连接始终有 remoteAddress；直接单测使用的内存 Socket 没有。
      if (req.socket.remoteAddress) {
        requestController.abort(new Error('客户端已断开连接'));
      }
    };
    req.once('aborted', onAborted);
    const scope = createAbortScope(
      requestController.signal,
      requestTimeoutMs,
      'Web 请求',
    );
    const taskLimits: ServerTaskLimits = {
      signal: scope.signal,
      llmTimeoutMs,
      maxOutputChars,
      maxOutputTokens,
    };
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
        await handleLocalModels(req, res, maxBodyBytes, taskLimits);
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
            taskLimits,
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
        await handleSearch(
          req,
          res,
          defaultLLM,
          maxBodyBytes,
          projectRoot,
          taskLimits,
        );
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
        await handleEval(req, res, defaultLLM, maxBodyBytes, taskLimits);
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
          : err instanceof OperationTimeoutError
            ? 504
            : err instanceof ResourceLimitError
              ? 429
              : isAbortError(err) || scope.signal.aborted
                ? 499
                : 500;
      serveJSON(res, status, { error: getErrorMessage(err) });
    } finally {
      scope.dispose();
      req.removeListener('aborted', onAborted);
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

function validateLimit(
  value: number,
  minimum: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label} 必须是 ${minimum}-${maximum} 的整数`);
  }
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
  server.requestTimeout = options.requestTimeoutMs ?? 5 * 60_000;
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
