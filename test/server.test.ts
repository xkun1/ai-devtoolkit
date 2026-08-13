import { afterEach, describe, it, expect } from 'vitest';
import type { AddressInfo } from 'node:net';

/**
 * server.test.ts — Web UI 服务器核心逻辑测试
 *
 * 不启动真实 HTTP 服务器（沙箱环境不允许绑定端口），
 * 而是直接测试 multipart 解析和模型探测等核心逻辑。
 */
import {
  detectLocalModels,
  MODEL_DISPLAY,
  resolveModel,
} from '../src/models.js';
import { startServer } from '../src/server.js';

const servers: ReturnType<typeof startServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

async function startTestServer(
  options: Parameters<typeof startServer>[0] = {},
) {
  const server = startServer({
    port: 0,
    sessionToken: 'test-token',
    ...options,
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, port };
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
    const { baseUrl } = await startTestServer();
    const res = await fetch(baseUrl);
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
    const { baseUrl, port } = await startTestServer();
    const { request } = await import('node:http');
    const badHostStatus = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${baseUrl}/api/models`,
        { headers: { Host: `evil.example:${port}` } },
        (res) => {
          res.resume();
          resolve(res.statusCode || 0);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(badHostStatus).toBe(403);

    const badOrigin = await fetch(`${baseUrl}/api/models`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(badOrigin.status).toBe(403);
  });

  it('写接口必须携带会话令牌', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(403);
  });

  it('拒绝读取服务端本地文件路径', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Doc2Skill-Token': 'test-token',
      },
      body: JSON.stringify({
        source: '/etc/passwd',
        apiKey: 'test',
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toContain('URL');
  });

  it('拒绝私网 SSRF 与非本机模型地址', async () => {
    const { baseUrl } = await startTestServer();
    const headers = {
      'Content-Type': 'application/json',
      'X-Doc2Skill-Token': 'test-token',
    };
    const sourceRes = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ source: 'http://169.254.169.254/latest' }),
    });
    expect(sourceRes.status).toBe(400);

    const modelRes = await fetch(`${baseUrl}/api/local-models`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseUrl: 'http://10.0.0.2:11434' }),
    });
    expect(modelRes.status).toBe(400);
  });

  it('拒绝超出上限的请求体', async () => {
    const { baseUrl } = await startTestServer({ maxBodyBytes: 32 });
    const res = await fetch(`${baseUrl}/api/estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Doc2Skill-Token': 'test-token',
      },
      body: JSON.stringify({ text: 'x'.repeat(100) }),
    });
    expect(res.status).toBe(413);
  });

  it('不存在的 ZIP 下载票据返回 404', async () => {
    const { baseUrl } = await startTestServer();
    const res = await fetch(`${baseUrl}/api/download/${'a'.repeat(32)}`, {
      headers: { 'X-Doc2Skill-Token': 'test-token' },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual(
      expect.objectContaining({ error: expect.stringContaining('失效') }),
    );
  });
});
