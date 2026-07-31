/**
 * 文档站点爬取器：给定一个根 URL，自动发现并抓取子页面
 *
 * 策略：
 * 1. 抓取根页面 HTML，提取正文 + 收集同域链接
 * 2. BFS 广度优先遍历，最多 maxDepth 层、maxPages 个页面
 * 3. 每个子页面提取正文，合并为一个大文档
 */
import { extractFromHtml } from './readability.js';
import type { LoadedDocument } from '../types/index.js';

export interface CrawlOptions {
  /** 最大深度（根页面 = 0） */
  maxDepth?: number;
  /** 最大页面数 */
  maxPages?: number;
  /** 同域限制（默认 true，只爬取同域名页面） */
  sameOrigin?: boolean;
  /** URL 包含模式（正则，只有匹配的 URL 才爬取） */
  urlPattern?: RegExp;
}

interface CrawlTask {
  url: string;
  depth: number;
}

/**
 * 爬取文档站点，合并为单个文档
 */
export async function crawlSite(
  rootUrl: string,
  options: CrawlOptions = {},
): Promise<LoadedDocument> {
  const maxDepth = options.maxDepth ?? 2;
  const maxPages = options.maxPages ?? 10;
  const sameOrigin = options.sameOrigin ?? true;

  const rootOrigin = new URL(rootUrl).origin;
  const visited = new Set<string>();
  const docs: LoadedDocument[] = [];
  const queue: CrawlTask[] = [{ url: rootUrl, depth: 0 }];

  while (queue.length > 0 && docs.length < maxPages) {
    const { url, depth } = queue.shift()!;
    const normalized = normalizeUrl(url);
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    // 抓取 HTML 一次
    const html = await fetchHtml(normalized);
    if (!html) continue;

    // 提取正文
    const { content, title, meta } = await extractFromHtml(html);
    docs.push({
      source: normalized,
      type: 'url',
      content,
      title,
      url: normalized,
      meta,
    });

    // 深度限制：超过 maxDepth 不提取子链接
    if (depth >= maxDepth) continue;

    // 从同一份 HTML 提取链接
    const links = await parseLinks(html, normalized, rootOrigin, sameOrigin);
    for (const link of links) {
      if (docs.length + queue.length >= maxPages) break;
      const norm = normalizeUrl(link);
      if (visited.has(norm)) continue;

      // URL 模式过滤
      if (options.urlPattern && !options.urlPattern.test(norm)) continue;

      queue.push({ url: norm, depth: depth + 1 });
    }
  }

  if (docs.length === 0) {
    throw new Error(`爬取失败：未能从 ${rootUrl} 获取任何页面`);
  }

  // 合并所有文档
  const parts = docs.map((doc, i) => {
    return `# ${doc.title || `Page ${i + 1}`}\n来源: ${doc.url}\n\n${doc.content}`;
  });

  return {
    source: rootUrl,
    type: 'url',
    content: parts.join('\n\n---\n\n'),
    title: docs[0]?.title || rootUrl,
    url: rootUrl,
    meta: {
      crawledPages: String(docs.length),
      rootUrl,
    },
  };
}

/** 从 HTML 中解析同域链接 */
async function parseLinks(
  html: string,
  baseUrl: string,
  rootOrigin: string,
  sameOrigin: boolean,
): Promise<string[]> {
  const $ = await cheerioLoad(html);
  const links = new Set<string>();

  $('a[href]').each((_: any, el: any) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) return;
    try {
      const absolute = new URL(href, baseUrl).href;
      const u = new URL(absolute);
      if (!/^https?:/.test(u.protocol)) return;
      if (sameOrigin && u.origin !== rootOrigin) return;
      links.add(absolute.split('#')[0]);
    } catch {
      // 无效 URL
    }
  });

  return [...links];
}

/** 延迟加载 cheerio */
async function cheerioLoad(html: string): Promise<any> {
  const cheerio = await import('cheerio');
  return cheerio.load(html);
}

/** 规范化 URL：去 hash、去 trailing slash（根路径除外） */
function normalizeUrl(url: string): string {
  const u = new URL(url);
  u.hash = '';
  let path = u.pathname;
  if (path.length > 1 && path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  u.pathname = path;
  return u.href;
}

/** 抓取 HTML */
async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(timeout);
  }
}
