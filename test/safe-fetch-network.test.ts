import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ResponsePlan {
  status: number;
  headers?: Record<string, string>;
  chunks?: string[];
  timeout?: boolean;
  hold?: boolean;
}

const mocks = vi.hoisted(() => ({
  dnsLookup: vi.fn(),
  httpRequest: vi.fn(),
  httpsRequest: vi.fn(),
  plans: [] as ResponsePlan[],
}));

vi.mock('node:dns/promises', () => ({ lookup: mocks.dnsLookup }));
vi.mock('node:http', () => ({ request: mocks.httpRequest }));
vi.mock('node:https', () => ({ request: mocks.httpsRequest }));

import { fetchPublicText } from '../src/utils/safe-fetch.js';

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

interface TransportOptions {
  lookup: (
    hostname: string,
    options: { all?: boolean },
    callback: LookupCallback,
  ) => void;
}

class FakeResponse extends EventEmitter {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  destroyed = false;

  constructor(plan: ResponsePlan) {
    super();
    this.statusCode = plan.status;
    this.headers = plan.headers ?? {};
  }

  resume(): void {}

  destroy(error?: Error): void {
    this.destroyed = true;
    if (error) queueMicrotask(() => this.emit('error', error));
  }
}

class FakeRequest extends EventEmitter {
  private timeoutCallback?: () => void;
  private destroyed = false;

  constructor(
    private readonly url: URL,
    private readonly options: TransportOptions,
    private readonly onResponse: (response: FakeResponse) => void,
    private readonly plan: ResponsePlan,
  ) {
    super();
  }

  setTimeout(_timeout: number, callback: () => void): void {
    this.timeoutCallback = callback;
  }

  destroy(error?: Error): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (error) queueMicrotask(() => this.emit('error', error));
    queueMicrotask(() => this.emit('close'));
  }

  end(): void {
    if (this.plan.timeout) {
      queueMicrotask(() => this.timeoutCallback?.());
      return;
    }
    this.options.lookup(this.url.hostname, { all: false }, (error) => {
      if (this.destroyed) return;
      if (error) {
        this.destroy(error);
        return;
      }
      if (this.plan.hold) return;
      queueMicrotask(() => {
        if (this.destroyed) return;
        const response = new FakeResponse(this.plan);
        this.onResponse(response);
        for (const chunk of this.plan.chunks ?? []) {
          if (response.destroyed) break;
          response.emit('data', Buffer.from(chunk));
        }
        if (!response.destroyed) response.emit('end');
        this.emit('close');
      });
    });
  }
}

function requestImplementation(...args: unknown[]): FakeRequest {
  const [url, options, callback] = args as [
    URL,
    TransportOptions,
    (response: FakeResponse) => void,
  ];
  const plan = mocks.plans.shift();
  if (!plan) throw new Error('缺少测试响应计划');
  return new FakeRequest(url, options, callback, plan);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plans.length = 0;
  mocks.dnsLookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  mocks.httpRequest.mockImplementation(requestImplementation);
  mocks.httpsRequest.mockImplementation(requestImplementation);
});

describe('安全远程抓取传输边界', () => {
  it('固定到已校验公网 IP 并返回文本', async () => {
    mocks.plans.push({
      status: 200,
      headers: { 'content-type': 'text/plain', 'content-length': '11' },
      chunks: ['hello ', 'world'],
    });
    await expect(fetchPublicText('https://example.com/docs')).resolves.toEqual({
      body: 'hello world',
      contentType: 'text/plain',
      finalUrl: 'https://example.com/docs',
    });
    expect(mocks.dnsLookup).toHaveBeenCalledWith('example.com', {
      all: true,
      verbatim: true,
    });
  });

  it('逐跳校验相对重定向并限制次数', async () => {
    mocks.plans.push(
      { status: 302, headers: { location: '/next' } },
      { status: 200, chunks: ['done'] },
    );
    const result = await fetchPublicText('https://example.com/start', {
      maxRedirects: 1,
    });
    expect(result.finalUrl).toBe('https://example.com/next');

    mocks.plans.push({ status: 302, headers: { location: '/again' } });
    await expect(
      fetchPublicText('https://example.com/start', { maxRedirects: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('拒绝非成功状态、声明超限与流式超限响应', async () => {
    mocks.plans.push({ status: 503 });
    await expect(fetchPublicText('https://example.com')).rejects.toMatchObject({
      status: 502,
    });

    mocks.plans.push({
      status: 200,
      headers: { 'content-length': '100' },
    });
    await expect(
      fetchPublicText('https://example.com', { maxBytes: 10 }),
    ).rejects.toMatchObject({ status: 413 });

    mocks.plans.push({ status: 200, chunks: ['123456', '789012'] });
    await expect(
      fetchPublicText('https://example.com', { maxBytes: 10 }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('拒绝解析到私网的域名', async () => {
    mocks.dnsLookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    mocks.plans.push({ status: 200, chunks: ['never'] });
    await expect(fetchPublicText('https://example.com')).rejects.toThrow(
      '私有或保留地址',
    );
  });

  it('支持请求超时与进行中取消', async () => {
    mocks.plans.push({ status: 200, timeout: true });
    await expect(
      fetchPublicText('https://example.com', { timeoutMs: 1 }),
    ).rejects.toMatchObject({ status: 504 });

    const controller = new AbortController();
    mocks.plans.push({ status: 200, hold: true });
    const pending = fetchPublicText('https://example.com', {
      signal: controller.signal,
    });
    controller.abort(new Error('用户取消抓取'));
    await expect(pending).rejects.toThrow('用户取消抓取');
  });
});
