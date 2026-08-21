import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  watch: vi.fn(),
  existsSync: vi.fn(),
}));
const pipelineMock = vi.hoisted(() => ({ runPipeline: vi.fn() }));
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('node:fs', () => fsMocks);
vi.mock('../src/pipeline.js', () => pipelineMock);
vi.mock('../src/utils/logger.js', () => loggerMock);

import { startWatch } from '../src/watcher.js';

const options = {
  agentType: 'codex' as const,
  llm: { apiKey: 'x', model: 'm' },
};

describe('startWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.watch.mockImplementation(() => ({ close: vi.fn() }));
    pipelineMock.runPipeline.mockResolvedValue(undefined);
  });

  afterEach(() => vi.useRealTimers());

  it('没有本地文件时只警告并返回空停止函数', () => {
    const stop = startWatch(['https://example.com/a.md'], options);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'watch 模式仅支持本地文件，URL 无法监控变更',
    );
    expect(fsMocks.watch).not.toHaveBeenCalled();
    expect(stop()).toBeUndefined();
  });

  it('跳过不存在文件，同时监控本地文件并执行首次生成', async () => {
    fsMocks.existsSync.mockImplementation(
      (file: string) => !file.includes('missing'),
    );
    const onChange = vi.fn();
    fsMocks.watch.mockImplementation((_file: string, callback: () => void) => {
      onChange.mockImplementation(callback);
      return { close: vi.fn() };
    });
    const stop = startWatch(
      ['a.md', 'missing.md', 'https://example.com'],
      options,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(pipelineMock.runPipeline).toHaveBeenCalledWith(
      ['a.md', 'missing.md', 'https://example.com'],
      options,
    );
    expect(loggerMock.warn).toHaveBeenCalledWith('文件不存在: missing.md');
    onChange();
    onChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(2);
    stop();
    expect(loggerMock.info).toHaveBeenCalledWith('\n  👋 已停止监控');
  });

  it('watch 创建失败时告警，首次生成失败时记录错误', async () => {
    fsMocks.watch.mockImplementation(() => {
      throw new Error('watch denied');
    });
    pipelineMock.runPipeline.mockRejectedValue(new Error('pipeline failed'));
    const stop = startWatch(['a.md'], options);
    await vi.advanceTimersByTimeAsync(0);
    expect(loggerMock.warn).toHaveBeenCalledWith('无法监控 a.md: watch denied');
    expect(loggerMock.error).toHaveBeenCalledWith(
      '首次生成失败: pipeline failed',
    );
    stop();
  });

  it('生成失败后仍可再次触发，且防止运行期间并发', async () => {
    let resolveFirst!: () => void;
    pipelineMock.runPipeline
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => (resolveFirst = resolve)),
      )
      .mockRejectedValueOnce(new Error('regenerate failed'));
    const onChange = vi.fn();
    fsMocks.watch.mockImplementation((_file: string, callback: () => void) => {
      onChange.mockImplementation(callback);
      return { close: vi.fn() };
    });
    startWatch(['a.md'], options);
    onChange();
    await vi.advanceTimersByTimeAsync(500);
    onChange();
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(2);
    resolveFirst();
    await vi.advanceTimersByTimeAsync(0);
    onChange();
    await vi.advanceTimersByTimeAsync(500);
    expect(pipelineMock.runPipeline).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(0);
    expect(loggerMock.error).toHaveBeenCalledWith(
      '重新生成失败: regenerate failed',
    );
  });
});
