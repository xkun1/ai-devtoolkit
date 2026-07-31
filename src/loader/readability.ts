import type { LoadedDocument } from '../types/index.js';

/**
 * 网页正文提取器：fetch HTML → cheerio 清洗 → turndown 转 Markdown
 * 启发式策略：移除噪声标签 → 定位正文容器 → 转换为干净的 Markdown
 */
export async function extractContent(url: string): Promise<{
  content: string;
  title: string;
  meta: Record<string, string>;
}> {
  const html = await fetchHtml(url);
  const $ = (await import('cheerio')).load(html);

  // 提取标题
  const title =
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    $('meta[property="og:title"]').attr('content') ||
    url;

  // 提取元信息
  const meta: Record<string, string> = {};
  $('meta[name]').each((_, el) => {
    const name = $(el).attr('name');
    const content = $(el).attr('content');
    if (name && content) meta[name] = content;
  });

  // 移除噪声标签
  const noiseSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'header', 'footer', 'aside',
    '.nav', '.navbar', '.header', '.footer', '.sidebar',
    '.menu', '.breadcrumb', '.pagination', '.ads', '.ad',
    '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    '.cookie', '.popup', '.modal', '.share', '.comments',
  ];
  $(noiseSelectors.join(', ')).remove();

  // 定位正文容器（优先级）
  const articleSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content', '.article-content', '.entry-content',
    '.content', '.markdown-body', '.documentation',
    '#content', '#main',
  ];

  let body = '';
  for (const sel of articleSelectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      body = el.html() || '';
      break;
    }
  }

  // 降级：找文本密度最高的容器
  if (!body) {
    body = findDensestContent($);
  }

  // 最终降级：body
  if (!body) {
    body = $('body').html() || '';
  }

  // HTML → Markdown
  const { default: TurndownService } = await import('turndown');
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '_',
  });
  turndown.remove('img'); // 移除图片（保留 alt 文字）
  const markdown = turndown.turndown(body);

  // 清理多余空行
  const cleaned = markdown
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();

  return { content: cleaned, title, meta };
}

/** 抓取 HTML，带 UA 伪装和超时 */
async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8',
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

/** 启发式：找文本密度最高的块级容器 */
function findDensestContent($: any): string {
  let best = { score: 0, html: '' };
  $('div, section').each((_: any, el: any) => {
    const $el = $(el);
    const text = $el.text().trim();
    const len = text.length;
    if (len < 200) return;
    // 密度 = 文本长度 / 标签数量（越多纯文字、越少嵌套 = 越高）
    const tagCount = $el.find('*').length;
    const density = len / (tagCount + 1);
    const linkLen = $el.find('a').text().length;
    const linkRatio = linkLen / (len + 1);
    // 惩罚链接密集区域（导航）
    const score = density * (1 - linkRatio * 0.5);
    if (score > best.score) {
      best = { score, html: $el.html() || '' };
    }
  });
  return best.html;
}
