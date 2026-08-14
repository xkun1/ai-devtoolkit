/**
 * 爬取器测试 — mock fetch，验证 BFS 遍历和链接发现逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { crawlSite } from '../src/loader/crawler.js';

const mockFetchPublicText = vi.hoisted(() => vi.fn());
vi.mock('../src/utils/safe-fetch.js', () => ({
  fetchPublicText: mockFetchPublicText,
}));

const makeHtml = (title: string, body: string, links: string[] = []) => {
  const linkTags = links.map((l) => `<a href="${l}">link</a>`).join('');
  return `<html><head><title>${title}</title></head>
    <body><nav>nav</nav><main>
    <h1>${title}</h1><p>${body}</p>
    ${linkTags}
    </main></body></html>`;
};

beforeEach(() => {
  mockFetchPublicText.mockReset();
});

function mockHtml(html: string, url = 'https://docs.example.com/') {
  return {
    body: html,
    contentType: 'text/html',
    finalUrl: url,
  };
}

describe('crawlSite', () => {
  it('单页面：无子链接时只返回根页面', async () => {
    mockFetchPublicText.mockResolvedValueOnce(
      mockHtml(
        makeHtml('Root', 'Root page content with enough text for extraction.'),
      ),
    );

    const doc = await crawlSite('https://docs.example.com/', { maxDepth: 2 });
    expect(doc.type).toBe('url');
    expect(doc.meta?.crawledPages).toBe('1');
    expect(doc.content).toContain('Root');
  }, 10000);

  it('发现子页面：BFS 遍历同域链接', async () => {
    // 根页面 → 包含指向 /guide 和 /api 的链接
    mockFetchPublicText.mockResolvedValueOnce(
      mockHtml(
        makeHtml('Root', 'Root content with enough text.', [
          'https://docs.example.com/guide',
          'https://docs.example.com/api',
        ]),
      ),
    );
    // /guide 子页面
    mockFetchPublicText.mockResolvedValueOnce(
      mockHtml(
        makeHtml('Guide', 'Guide page content with enough text.'),
        'https://docs.example.com/guide',
      ),
    );
    // /api 子页面
    mockFetchPublicText.mockResolvedValueOnce(
      mockHtml(
        makeHtml('API', 'API page content with enough text.'),
        'https://docs.example.com/api',
      ),
    );

    const doc = await crawlSite('https://docs.example.com/', { maxDepth: 1 });
    expect(doc.meta?.crawledPages).toBe('3');
    expect(doc.content).toContain('Root');
    expect(doc.content).toContain('Guide');
    expect(doc.content).toContain('API');
  }, 10000);

  it('maxPages 限制页面数量', async () => {
    mockFetchPublicText.mockResolvedValue(
      mockHtml(
        makeHtml('Page', 'Content.', [
          'https://docs.example.com/p2',
          'https://docs.example.com/p3',
        ]),
      ),
    );

    const doc = await crawlSite('https://docs.example.com/', {
      maxDepth: 3,
      maxPages: 2,
    });
    expect(Number(doc.meta?.crawledPages)).toBeLessThanOrEqual(2);
  }, 10000);

  it('同域限制：不爬取外域链接', async () => {
    mockFetchPublicText.mockResolvedValueOnce(
      mockHtml(
        makeHtml(
          'Root',
          'Root content.',
          ['https://other.com/page'], // 外域链接
        ),
      ),
    );

    const doc = await crawlSite('https://docs.example.com/');
    expect(doc.meta?.crawledPages).toBe('1'); // 只有根页面
  }, 10000);

  it('拒绝超出安全范围的爬取参数', async () => {
    await expect(
      crawlSite('https://docs.example.com/', { maxDepth: 11 }),
    ).rejects.toThrow('maxDepth');
    await expect(
      crawlSite('https://docs.example.com/', { maxPages: 0 }),
    ).rejects.toThrow('maxPages');
    expect(mockFetchPublicText).not.toHaveBeenCalled();
  });
});
