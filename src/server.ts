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

import { MODEL_DISPLAY, resolveModel } from './models.js';

/** 启动 Web UI 服务器 */
export function startServer(options: ServerOptions = {}): void {
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
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
}

// ─── 请求处理 ───

async function handleGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
): Promise<void> {
  const body = await readBody(req);
  const { source, agentType, template, modelName, apiKey, skillName } = body;

  if (!source) {
    serveJSON(res, 400, { error: '缺少 source 参数' });
    return;
  }

  try {
    const llmConfig = resolveModel(modelName || defaultLLM.model, {
      apiKey: apiKey || defaultLLM.apiKey,
      baseUrl: defaultLLM.baseURL,
    });
    const result = await runPipeline(source, {
      agentType: agentType || 'codex',
      llm: llmConfig,
      name: skillName,
      stdout: false,
      dryRun: true, // 不写文件，直接返回内容
      force: false,
      crawl: false,
      incremental: false,
      template: template || undefined,
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
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(WEB_UI_HTML);
}

function serveJSON(res: ServerResponse, status: number, data: any): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

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
