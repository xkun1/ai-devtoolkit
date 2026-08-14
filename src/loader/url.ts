import type { LoadedDocument } from '../types/index.js';
import { extractContent } from './readability.js';
import { loadFromOpenApi, isOpenApiSpec } from './openapi.js';

export async function loadFromUrl(url: string): Promise<LoadedDocument> {
  // 1. 如果 URL 明确是 OpenAPI / Swagger 规范端点
  if (
    /\.(json|ya?ml)$/i.test(url) ||
    /(swagger|openapi|api[-_]docs)/i.test(url)
  ) {
    try {
      return await loadFromOpenApi(url);
    } catch {
      // 回退到常规网页抓取
    }
  }

  // 2. 常规提取
  const { content, title, meta } = await extractContent(url);

  // 3. 如果提取后的正文符合 OpenAPI 规范，转由 OpenAPI 加载器结构化解析
  if (isOpenApiSpec(content, url)) {
    try {
      return await loadFromOpenApi(url, content);
    } catch {
      // 忽略异常，使用常规文本
    }
  }

  return {
    source: url,
    type: 'url',
    content,
    title,
    url,
    meta,
  };
}
