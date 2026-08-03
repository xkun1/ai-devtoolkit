import { describe, it, expect } from 'vitest';
import {
  MODEL_PRESETS,
  MODEL_DISPLAY,
  isLocalModel,
  resolveModel,
  detectLocalModels,
} from '../src/models.js';

describe('models 注册表', () => {
  it('应包含所有云端模型预设', () => {
    expect(MODEL_PRESETS['deepseek-chat']).toBeDefined();
    expect(MODEL_PRESETS['gpt-4o']).toBeDefined();
    expect(MODEL_PRESETS['doubao-pro-32k']).toBeDefined();
  });

  it('应包含本地模型预设', () => {
    expect(MODEL_PRESETS['ollama-local']?.local).toBe(true);
    expect(MODEL_PRESETS['lmstudio-local']?.local).toBe(true);
    expect(MODEL_PRESETS['custom-local']?.local).toBe(true);
  });

  it('MODEL_DISPLAY 应包含所有模型', () => {
    const ids = MODEL_DISPLAY.map((m) => m.id);
    expect(ids).toContain('deepseek-chat');
    expect(ids).toContain('ollama-local');
    expect(ids).toContain('custom-local');
  });

  it('本地模型应有 defaultBaseUrl（custom-local 除外）', () => {
    const ollama = MODEL_DISPLAY.find((m) => m.id === 'ollama-local');
    expect(ollama?.defaultBaseUrl).toBe('http://localhost:11434');
    const lmstudio = MODEL_DISPLAY.find((m) => m.id === 'lmstudio-local');
    expect(lmstudio?.defaultBaseUrl).toBe('http://localhost:1234');
  });
});

describe('isLocalModel', () => {
  it('正确识别本地模型', () => {
    expect(isLocalModel('ollama-local')).toBe(true);
    expect(isLocalModel('lmstudio-local')).toBe(true);
    expect(isLocalModel('custom-local')).toBe(true);
  });

  it('正确识别云端模型（非本地）', () => {
    expect(isLocalModel('deepseek-chat')).toBe(false);
    expect(isLocalModel('gpt-4o')).toBe(false);
  });
});

describe('resolveModel', () => {
  it('本地模型不需要 API Key', () => {
    const config = resolveModel('ollama-local', {});
    expect(config.apiKey).toBe('local-no-key');
    expect(config.baseURL).toContain('localhost');
  });

  it('本地模型支持 localModelName 传入', () => {
    const config = resolveModel('custom-local', {
      baseUrl: 'http://localhost:5001',
      localModelName: 'llama3:8b',
    });
    expect(config.model).toBe('llama3:8b');
    expect(config.baseURL).toBe('http://localhost:5001');
    expect(config.apiKey).toBe('local-no-key');
  });

  it('custom-local 无地址时 baseURL 应为 undefined 而非空字符串', () => {
    const config = resolveModel('custom-local', {});
    expect(config.baseURL).toBeUndefined();
    expect(config.model).toBe('custom-local');
  });

  it('custom-local 无地址时不会误连 OpenAI 官方 API', () => {
    const config = resolveModel('custom-local', {
      localModelName: 'test-model',
    });
    // 修复前：baseURL 为 '' → OpenAI SDK 默认连 api.openai.com
    // 修复后：baseURL 为 undefined，但仍应校验 apiKey 占位符
    expect(config.baseURL).toBeUndefined();
    expect(config.apiKey).toBe('local-no-key');
  });

  it('云端模型需要 API Key', () => {
    const config = resolveModel('deepseek-chat', {
      apiKey: 'sk-test',
    });
    expect(config.apiKey).toBe('sk-test');
    expect(config.model).toBe('deepseek-chat');
    expect(config.baseURL).toBe('https://api.deepseek.com/v1');
  });
});

describe('detectLocalModels', () => {
  it('空地址返回空数组', async () => {
    const models = await detectLocalModels('');
    expect(models).toEqual([]);
  });

  it('连接失败的地址返回空数组', async () => {
    const models = await detectLocalModels('http://localhost:59999');
    expect(models).toEqual([]);
  }, 10000);

  it('地址末尾斜杠自动去除', async () => {
    const models = await detectLocalModels('http://localhost:59999///');
    expect(models).toEqual([]);
  }, 10000);
});
