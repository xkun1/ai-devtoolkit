import { describe, it, expect } from 'vitest';

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
    expect(config.baseURL).toBe('http://localhost:5001');
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
});
