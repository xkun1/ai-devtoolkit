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
import { runPipeline } from './pipeline.js';
import { listTemplates } from './templates/index.js';
import { estimateTokens } from './utils/token.js';
import { WEB_UI_HTML } from './server/html.js';
export { WEB_UI_HTML } from './server/html.js';

export interface ServerOptions {
  port?: number;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

import { MODEL_DISPLAY, resolveModel, detectLocalModels } from './models.js';

/** 启动 Web UI 服务器 */
export function startServer(options: ServerOptions = {}): Server {
  const port = options.port ?? 3456;
  const defaultLLM = {
    apiKey: options.apiKey || '',
    baseURL: options.baseURL,
    model: options.model || 'deepseek-chat',
  };

  const server = createServer(async (req, res) => {
    try {
      // CORS
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Content-Disposition',
      );

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // ─── 路由 ───
      if (url.pathname === '/' && req.method === 'GET') {
        serveHTML(res);
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
        await handleLocalModels(req, res);
        return;
      }

      if (url.pathname === '/api/generate' && req.method === 'POST') {
        await handleGenerate(req, res, defaultLLM);
        return;
      }

      if (url.pathname === '/api/estimate' && req.method === 'POST') {
        await handleEstimate(req, res);
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    } catch (err: any) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  server.listen(port, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║  🌐 doc2skill Web UI                     ║`);
  });
  // 延迟输出 URL，确保 listen 回调先执行
  setTimeout(() => {
    console.log(`  ║                                          ║`);
    console.log(`  ║  浏览器打开: http://localhost:${port}       `);
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
): Promise<void> {
  const body = await readBody(req);
  const { baseUrl } = body;
  if (!baseUrl) {
    serveJSON(res, 400, { error: '缺少 baseUrl 参数' });
    return;
  }
  try {
    const models = await detectLocalModels(baseUrl);
    serveJSON(res, 200, { models, count: models.length });
  } catch (err: any) {
    serveJSON(res, 500, { error: err.message });
  }
}

async function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
): Promise<void> {
  const contentType = req.headers['content-type'] || '';

  let body: any;
  if (contentType.includes('multipart/form-data')) {
    body = await readMultipartBody(req);
  } else {
    body = await readBody(req);
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

  // 调试日志（帮助排查文件上传问题）
  console.error('[debug] source:', source ? source.slice(0, 80) : '空');
  console.error(
    '[debug] fileContent:',
    fileContent ? fileContent.length + ' 字符' : '空',
  );
  console.error(
    '[debug] binaryContent:',
    binaryContent ? binaryContent.length + ' 字符' : '空',
  );
  console.error('[debug] mimeType:', mimeType || '空');
  console.error('[debug] fileName:', fileName || '空');

  // 区分来源类型：URL/路径 vs 上传文件内容
  const hasUrlOrPath = source && source.trim().length > 0;
  const hasFileContent =
    (fileContent && fileContent.trim().length > 0) ||
    (binaryContent && binaryContent.length > 0);

  if (!hasUrlOrPath && !hasFileContent) {
    serveJSON(res, 400, { error: '缺少文档来源（URL/路径 或 上传文件）' });
    return;
  }

  try {
    const llmConfig = resolveModel(modelName || defaultLLM.model, {
      apiKey: apiKey || defaultLLM.apiKey,
      baseUrl: localBaseUrl || defaultLLM.baseURL,
      localModelName,
    });

    // 文件上传优先：有上传文件时忽略 URL，用 preloaded
    const usePreloaded = hasFileContent;
    const pipelineSource = usePreloaded ? '__preloaded__' : source!;
    const result = await runPipeline(pipelineSource, {
      agentType: agentType || 'codex',
      llm: llmConfig,
      name: (fileName || skillName || '').replace(/\.[^.]+$/, '') || undefined,
      stdout: false,
      dryRun: true, // 不写文件，直接返回内容
      force: false,
      crawl: false,
      incremental: false,
      template: template || undefined,
      // 文件上传内容通过 preloaded 传入，不再当路径处理
      preloaded: usePreloaded
        ? {
            content: fileContent || '',
            binaryContent: binaryContent || undefined,
            mimeType: mimeType || undefined,
            fileName: fileName || 'uploaded',
            source: fileName || 'file-upload',
          }
        : undefined,
    });

    serveJSON(res, 200, {
      content: result.content,
      agentType: result.agentType,
      suggestedPath: result.suggestedPath,
      size: result.content.length,
    });
  } catch (err: any) {
    serveJSON(res, 500, { error: err.message });
  }
}

async function handleEstimate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  const { text } = body;
  if (!text) {
    serveJSON(res, 400, { error: '缺少 text 参数' });
    return;
  }
  serveJSON(res, 200, { tokens: estimateTokens(text) });
}

// ─── 工具函数 ───

function serveHTML(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(WEB_UI_HTML);
}

function serveJSON(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/** 读取 JSON 请求体 */
async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * 解析 multipart/form-data 请求体（用于文件上传）
 * 零依赖手动解析 boundary 分隔的表单数据
 */
async function readMultipartBody(
  req: IncomingMessage,
): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: any) => chunks.push(Buffer.from(chunk)));
    req.on('error', reject);
    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
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
          const content = partBuf
            .subarray(headerEnd + headerSep.length)
            .toString('utf-8');

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
            result['fileContent'] = content;
            result['fileName'] = filenameMatch[1];
          } else {
            result[fieldName] = content;
          }

          offset = nextSep;
        }

        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
  });
}
