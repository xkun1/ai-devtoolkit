/** 端到端测试：使用确定性传输桩验证 URL → HTML 清洗 → 文档模型完整链路。 */
import { beforeEach, describe, it, expect, vi } from 'vitest';

const mockFetchPublicText = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/safe-fetch.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/utils/safe-fetch.js')>()),
  fetchPublicText: mockFetchPublicText,
}));
import { loadFromUrl } from '../src/loader/url.js';

beforeEach(() => mockFetchPublicText.mockReset());

describe('URL Loader E2E', () => {
  it('无需外网即可加载并提取网页正文', async () => {
    mockFetchPublicText.mockResolvedValue({
      body: `<!doctype html><html><head><title>本地测试文档</title></head><body>
        <nav>应被移除</nav><main><h1>指南</h1><p>${'稳定正文内容 '.repeat(30)}</p></main>
      </body></html>`,
      contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://docs.example.test/guide',
    });
    const doc = await loadFromUrl('https://docs.example.test/guide');
    expect(doc.type).toBe('url');
    expect(doc.content).toContain('稳定正文内容');
    expect(doc.content).not.toContain('应被移除');
    expect(doc.title).toBe('本地测试文档');
    expect(mockFetchPublicText).toHaveBeenCalledTimes(1);
  });
});
