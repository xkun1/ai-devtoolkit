/**
 * LLM 重试机制测试 — mock OpenAI SDK，验证指数退避行为
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isRetryableError, callLLM } from '../src/transform/llm.js';

// mock openai 模块：create 方法的行为由各用例动态控制
const mockCreate = vi.fn();
vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

const config = { apiKey: 'test-key', model: 'test-model' };

describe('isRetryableError', () => {
  it('429 限流可重试', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
  });

  it('5xx 服务端错误可重试', () => {
    expect(isRetryableError({ status: 500 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it('4xx 客户端错误不可重试', () => {
    expect(isRetryableError({ status: 400 })).toBe(false);
    expect(isRetryableError({ status: 401 })).toBe(false);
    expect(isRetryableError({ status: 404 })).toBe(false);
  });

  it('网络错误码可重试', () => {
    expect(isRetryableError({ code: 'ECONNRESET' })).toBe(true);
    expect(isRetryableError({ code: 'ETIMEDOUT' })).toBe(true);
  });

  it('fetch failed 消息可重试', () => {
    expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
  });

  it('普通错误不可重试', () => {
    expect(isRetryableError(new Error('something else'))).toBe(false);
  });
});

describe('callLLM 重试行为', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const successResponse = () => ({
    choices: [{ message: { content: '# Skill Content' } }],
  });

  it('首次成功：不重试，直接返回', async () => {
    mockCreate.mockResolvedValueOnce(successResponse());
    const promise = callLLM('prompt', config);
    await vi.runAllTimersAsync();
    const content = await promise;
    expect(content).toBe('# Skill Content');
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('429 后重试成功：共调用 2 次', async () => {
    mockCreate
      .mockRejectedValueOnce({ status: 429, message: 'rate limited' })
      .mockResolvedValueOnce(successResponse());

    const promise = callLLM('prompt', config);
    // 第 1 次失败 → 等待 1s → 第 2 次成功
    await vi.runAllTimersAsync();
    const content = await promise;
    expect(content).toBe('# Skill Content');
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it('401 认证失败：不重试，直接抛出', async () => {
    mockCreate.mockRejectedValue({ status: 401, message: 'unauthorized' });
    // 挂一个 catch 防止未处理的 rejection 警告
    const promise = callLLM('prompt', config).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err.status).toBe(401);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('持续 5xx：重试 3 次后抛出（共 4 次调用）', async () => {
    mockCreate.mockRejectedValue({ status: 500, message: 'server error' });
    const promise = callLLM('prompt', config).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err.status).toBe(500);
    expect(mockCreate).toHaveBeenCalledTimes(4); // 1 + 3 次重试
  });

  it('LLM 返回空内容：抛出错误', async () => {
    mockCreate.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    const promise = callLLM('prompt', config).catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await promise;
    expect(err.message).toBe('LLM 返回空内容');
  });
});
