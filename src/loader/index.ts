import { readFile } from 'node:fs/promises';
import type { LoadedDocument, SourceType } from '../types/index.js';
import { loadFromUrl } from './url.js';
import { loadFromPdf } from './pdf.js';
import { loadFromFile } from './file.js';
import { loadFromHtml } from './html.js';
import { loadFromDocx } from './doc.js';
import { loadFromOpenApi, isOpenApiSpec } from './openapi.js';
import { loadFromPostman, isPostmanCollection } from './postman.js';
import { isAbortError, throwIfAborted } from '../utils/abort.js';

export interface LoadOptions {
  signal?: AbortSignal;
}

/** 判断 source 类型 */
export function detectSourceType(source: string): SourceType {
  if (/^https?:\/\//i.test(source)) return 'url';
  if (/\.pdf$/i.test(source)) return 'pdf';
  if (/\.docx?$/i.test(source)) return 'text';
  if (/\.html?$/i.test(source)) return 'html';
  if (/\.(md|markdown)$/i.test(source)) return 'markdown';
  if (/\.(txt|text|rst|html?|xml|json|ya?ml|csv)$/i.test(source)) return 'text';
  return 'text';
}

/** 统一加载入口：按来源分发 */
export async function loadDocument(
  source: string,
  options: LoadOptions = {},
): Promise<LoadedDocument> {
  throwIfAborted(options.signal, '文档加载');
  const type = detectSourceType(source);
  switch (type) {
    case 'url':
      return loadFromUrl(source, { signal: options.signal });
    case 'pdf':
      return loadFromPdf(source);
    case 'html':
      return loadFromHtml(source);
    default: {
      if (/\.docx?$/i.test(source)) return loadFromDocx(source);

      // JSON / YAML 规范检查（Postman 或 OpenAPI）
      if (
        /\.(json|ya?ml)$/i.test(source) ||
        /(openapi|swagger|postman|collection|api[-_]docs)/i.test(source)
      ) {
        try {
          const raw = await readFile(source, 'utf-8');
          const parsed = JSON.parse(raw);
          if (isPostmanCollection(parsed)) {
            return await loadFromPostman(source);
          }
          if (isOpenApiSpec(raw, source)) {
            return await loadFromOpenApi(source, raw);
          }
        } catch {
          // 不是规范格式则走普通文件读取
        }
      }

      return loadFromFile(source, type);
    }
  }
}

/** 并发加载多个来源 */
export async function loadDocuments(
  sources: string[],
  options: LoadOptions = {},
): Promise<LoadedDocument[]> {
  return Promise.all(
    sources.map(async (source) => {
      try {
        return await loadDocument(source, options);
      } catch (err: unknown) {
        if (isAbortError(err)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`加载 ${source} 失败: ${message}`, { cause: err });
      }
    }),
  );
}

/** 将多个文档合并为一个 */
export function mergeDocuments(docs: LoadedDocument[]): LoadedDocument {
  if (docs.length === 1) return docs[0];

  const parts = docs.map((doc, i) => {
    const label = doc.title || doc.source;
    return `# 文档 ${i + 1}: ${label}\n来源: ${doc.url || doc.source}\n\n${doc.content}`;
  });

  return {
    source: docs.map((d) => d.source).join(', '),
    type: docs[0].type,
    content: parts.join('\n\n---\n\n'),
    title: docs[0].title,
    meta: { mergedCount: String(docs.length) },
  };
}

export { loadFromUrl, loadFromPdf, loadFromFile, loadFromHtml, loadFromDocx };
export {
  loadFromOpenApi,
  isOpenApiSpec,
  parseOpenApiSpec,
  renderOpenApiToMarkdown,
  extractOpenApiFromBuffer,
} from './openapi.js';
export type {
  OpenApiParameter,
  OpenApiField,
  OpenApiEndpoint,
  ParsedOpenApi,
} from './openapi.js';
export {
  loadFromPostman,
  isPostmanCollection,
  parsePostmanCollection,
  renderPostmanToMarkdown,
  extractPostmanFromBuffer,
} from './postman.js';
export type {
  PostmanEndpoint,
  ParsedPostmanCollection,
  PostmanHeader,
  PostmanQueryParam,
} from './postman.js';
export { crawlSite } from './crawler.js';
export type { CrawlOptions } from './crawler.js';
export {
  scanDirectory,
  isDirectory,
  isSupportedFile,
  expandSources,
} from './directory.js';
export type { ScanOptions } from './directory.js';
