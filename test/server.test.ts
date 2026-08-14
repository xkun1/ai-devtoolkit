import { describe, it, expect } from 'vitest';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

/**
 * server.test.ts — Web UI 服务器核心逻辑测试
 *
 * 通过 createRequestHandler 直接测试 HTTP 路由、安全头、SSRF 防御与模型探测等核心逻辑，
 * 避免在受限沙箱环境中因端口绑定权限产生 EPERM。
 */
import {
  detectLocalModels,
  MODEL_DISPLAY,
  resolveModel,
} from '../src/models.js';
import { startServer, createRequestHandler } from '../src/server.js';

interface MockResponse {
  status: number;
  statusCode: number;
  headers: {
    get: (name: string) => string | null;
    [key: string]: any;
  };
  text: () => Promise<string>;
  json: () => Promise<any>;
}

async function invokeRequest(
  options: Parameters<typeof createRequestHandler>[0] = {},
  reqOpts: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  } = {},
): Promise<MockResponse> {
  const port = options.port ?? 3456;
  const { handler } = createRequestHandler({
    port,
    sessionToken: 'test-token',
    ...options,
  });

  const method = reqOpts.method || 'GET';
  const url = reqOpts.url || '/';
  const rawHeaders: Record<string, string> = {
    host: `127.0.0.1:${port}`,
    ...(reqOpts.headers || {}),
  };

  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.method = method;
  req.url = url;
  req.headers = Object.fromEntries(
    Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );

  let responseBody = '';
  const resHeaders: Record<string, string> = {};
  let statusCode = 200;

  const res = new ServerResponse(req);
  res.writeHead = function (code: number, ...args: any[]) {
    statusCode = code;
    for (const arg of args) {
      if (typeof arg === 'object' && arg !== null) {
        for (const [k, v] of Object.entries(arg)) {
          resHeaders[k.toLowerCase()] = String(v);
        }
      }
    }
    return this;
  } as any;

  res.setHeader = function (name: string, value: any) {
    resHeaders[name.toLowerCase()] = String(value);
    return this;
  };

  res.getHeader = function (name: string) {
    return resHeaders[name.toLowerCase()];
  };

  const endPromise = new Promise<void>((resolve) => {
    res.end = function (chunk?: any) {
      if (chunk) {
        responseBody += Buffer.isBuffer(chunk)
          ? chunk.toString('utf-8')
          : String(chunk);
      }
      resolve();
      return this;
    } as any;
  });

  res.write = function (chunk: any) {
    if (chunk) {
      responseBody += Buffer.isBuffer(chunk)
        ? chunk.toString('utf-8')
        : String(chunk);
    }
    return true;
  } as any;

  const handlerPromise = handler(req, res);

  if (reqOpts.body) {
    req.push(reqOpts.body);
  }
  req.push(null);

  await Promise.all([handlerPromise, endPromise]);

  return {
    status: statusCode,
    statusCode,
    headers: {
      get: (name: string) => resHeaders[name.toLowerCase()] || null,
      ...resHeaders,
    },
    text: async () => responseBody,
    json: async () => JSON.parse(responseBody || '{}'),
  };
}

describe('Web UI — 核心功能验证', () => {
  it('模型列表包含本地模型配置', () => {
    const localModels = MODEL_DISPLAY.filter((m) => m.local);
    expect(localModels.length).toBeGreaterThanOrEqual(3);
    expect(localModels.some((m) => m.id === 'ollama-local')).toBe(true);
    expect(localModels.some((m) => m.id === 'lmstudio-local')).toBe(true);
    expect(localModels.some((m) => m.id === 'custom-local')).toBe(true);
  });

  it('本地模型有默认地址提示（custom-local 除外）', () => {
    const ollama = MODEL_DISPLAY.find((m) => m.id === 'ollama-local');
    expect(ollama?.defaultBaseUrl).toBe('http://localhost:11434');
    const lmstudio = MODEL_DISPLAY.find((m) => m.id === 'lmstudio-local');
    expect(lmstudio?.defaultBaseUrl).toBe('http://localhost:1234');
  });

  it('自定义本地模型 resolveModel 支持 localModelName', () => {
    const config = resolveModel('custom-local', {
      baseUrl: 'http://localhost:5001',
      localModelName: 'llama3:8b',
    });
    expect(config.model).toBe('llama3:8b');
    expect(config.baseURL).toBe('http://localhost:5001/v1');
    expect(config.apiKey).toBe('local-no-key');
  });

  it('detectLocalModels 空地址返回空列表', async () => {
    const result = await detectLocalModels('');
    expect(result).toEqual([]);
  });

  it('detectLocalModels 连接失败返回空列表', async () => {
    const result = await detectLocalModels('http://localhost:59999');
    expect(result).toEqual([]);
  }, 10000);

  it('detectLocalModels 去除尾部斜杠', async () => {
    const result = await detectLocalModels('http://localhost:59999/');
    expect(result).toEqual([]);
  }, 10000);
});

describe('Web UI — HTML 模板验证', () => {
  it('HTML 模板包含文件上传区', async () => {
    const { WEB_UI_HTML } = await import('../src/server/html.js');
    expect(WEB_UI_HTML).toContain('upload-zone');
    expect(WEB_UI_HTML).toContain('fileInput');
    expect(WEB_UI_HTML).toContain('handleFile');
  });

  it('HTML 模板包含本地模型探测区', async () => {
    const { WEB_UI_HTML } = await import('../src/server/html.js');
    expect(WEB_UI_HTML).toContain('localConfig');
    expect(WEB_UI_HTML).toContain('detectBtn');
    expect(WEB_UI_HTML).toContain('localBaseUrl');
    expect(WEB_UI_HTML).toContain('detectLocalModels');
  });

  it('HTML 模板包含拖拽上传支持', async () => {
    const { WEB_UI_HTML } = await import('../src/server/html.js');
    expect(WEB_UI_HTML).toContain('dragover');
    expect(WEB_UI_HTML).toContain('drop');
  });

  it('HTML 模板包含完整 ZIP 下载逻辑', async () => {
    const { WEB_UI_HTML } = await import('../src/server/html.js');
    expect(WEB_UI_HTML).toContain('下载完整 ZIP');
    expect(WEB_UI_HTML).toContain('lastZip.id');
    expect(WEB_UI_HTML).toContain('downloadZip');
    expect(WEB_UI_HTML).toContain('triggerDownload');
  });
});

describe('Web UI — HTTP 安全边界', () => {
  it('仅允许监听回环地址', () => {
    expect(() => startServer({ host: '0.0.0.0' })).toThrow('回环地址');
  });

  it('首页注入会话令牌并设置安全响应头', async () => {
    const res = await invokeRequest({}, { url: '/' });
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('test-token');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get('content-security-policy')).toContain(
      "script-src 'nonce-test-token'",
    );
    expect(res.headers.get('content-security-policy')).not.toContain(
      "script-src 'unsafe-inline'",
    );
  });

  it('拒绝伪造 Host 和跨站 Origin', async () => {
    const badHost = await invokeRequest(
      {},
      { url: '/api/models', headers: { host: 'evil.example:3456' } },
    );
    expect(badHost.status).toBe(403);

    const badOrigin = await invokeRequest(
      {},
      { url: '/api/models', headers: { origin: 'https://evil.example' } },
    );
    expect(badOrigin.status).toBe(403);
  });

  it('写接口必须携带会话令牌', async () => {
    const res = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/estimate',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      },
    );
    expect(res.status).toBe(403);
  });

  it('拒绝读取服务端本地文件路径', async () => {
    const res = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/generate',
        headers: {
          'content-type': 'application/json',
          'x-devtoolkit-token': 'test-token',
        },
        body: JSON.stringify({
          source: '/etc/passwd',
          apiKey: 'test',
        }),
      },
    );
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain('URL');
  });

  it('拒绝私网 SSRF 与非本机模型地址', async () => {
    const headers = {
      'content-type': 'application/json',
      'x-devtoolkit-token': 'test-token',
    };
    const sourceRes = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/generate',
        headers,
        body: JSON.stringify({ source: 'http://169.254.169.254/latest' }),
      },
    );
    expect(sourceRes.status).toBe(400);

    const modelRes = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/local-models',
        headers,
        body: JSON.stringify({ baseUrl: 'http://10.0.0.2:11434' }),
      },
    );
    expect(modelRes.status).toBe(400);
  });

  it('拒绝超出上限的请求体', async () => {
    const res = await invokeRequest(
      { maxBodyBytes: 32 },
      {
        method: 'POST',
        url: '/api/estimate',
        headers: {
          'content-type': 'application/json',
          'x-devtoolkit-token': 'test-token',
        },
        body: JSON.stringify({ text: 'x'.repeat(100) }),
      },
    );
    expect(res.status).toBe(413);
  });

  it('不存在的 ZIP 下载票据返回 404', async () => {
    const res = await invokeRequest(
      {},
      {
        method: 'GET',
        url: `/api/download/${'a'.repeat(32)}`,
        headers: { 'x-devtoolkit-token': 'test-token' },
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: expect.stringContaining('失效') }),
    );
  });
});

describe('Web UI — 代码搜索与环境资产 API', () => {
  it('代码搜索接口校验会话令牌并返回结果', async () => {
    // 未带 token 被拦截
    const noToken = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/search',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'test' }),
      },
    );
    expect(noToken.status).toBe(403);

    // 空查询报错
    const emptyQuery = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/search',
        headers: {
          'content-type': 'application/json',
          'x-devtoolkit-token': 'test-token',
        },
        body: JSON.stringify({ query: '' }),
      },
    );
    expect(emptyQuery.status).toBe(400);

    // 正常搜索
    const searchRes = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/search',
        headers: {
          'content-type': 'application/json',
          'x-devtoolkit-token': 'test-token',
        },
        body: JSON.stringify({ query: 'createRequestHandler' }),
      },
    );
    expect(searchRes.status).toBe(200);
    const body = await searchRes.json();
    expect(body.query).toBe('createRequestHandler');
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('环境探测与比对接口正常响应', async () => {
    const detectRes = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/env/detect',
        headers: { 'x-devtoolkit-token': 'test-token' },
      },
    );
    expect(detectRes.status).toBe(200);
    const detectBody = await detectRes.json();
    expect(detectBody.snapshot).toBeDefined();
    expect(detectBody.snapshot.version).toBe('1.0.0');

    // 比对 diff
    const diffRes = await invokeRequest(
      {},
      {
        method: 'POST',
        url: '/api/env/diff',
        headers: {
          'content-type': 'application/json',
          'x-devtoolkit-token': 'test-token',
        },
        body: JSON.stringify({ snapshot: detectBody.snapshot }),
      },
    );
    expect(diffRes.status).toBe(200);
    const diffBody = await diffRes.json();
    expect(diffBody.diff).toBeDefined();
    expect(diffBody.preview).toContain('环境差异比对结果');
  });
});
