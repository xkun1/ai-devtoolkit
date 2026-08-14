import { readFile } from 'node:fs/promises';
import type { LoadedDocument, SourceType } from '../types/index.js';
import { loadFromUrl } from './url.js';
import { loadFromPdf } from './pdf.js';
import { loadFromFile } from './file.js';
import { loadFromHtml } from './html.js';
import { loadFromDocx } from './doc.js';
import { loadFromOpenApi, isOpenApiSpec } from './openapi.js';

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
export async function loadDocument(source: string): Promise<LoadedDocument> {
  const type = detectSourceType(source);
  switch (type) {
    case 'url':
      return loadFromUrl(source);
    case 'pdf':
      return loadFromPdf(source);
    case 'html':
      return loadFromHtml(source);
    default: {
      // docx 文件用专用 loader
      if (/\.docx?$/i.test(source)) return loadFromDocx(source);

      // OpenAPI / Swagger 规范检查（JSON / YAML）
      if (
        /\.(json|ya?ml)$/i.test(source) ||
        /(openapi|swagger|api[-_]docs)/i.test(source)
      ) {
        try {
          const raw = await readFile(source, 'utf-8');
          if (isOpenApiSpec(raw, source)) {
            return await loadFromOpenApi(source, raw);
          }
        } catch {
          // 不是 OpenAPI 则走普通文件读取
        }
      }

      return loadFromFile(source, type);
    }
  }
}

/** 并发加载多个来源；任一失败即整体失败并指明来源 */
export async function loadDocuments(
  sources: string[],
): Promise<LoadedDocument[]> {
  return Promise.all(
    sources.map(async (source) => {
      try {
        return await loadDocument(source);
      } catch (err: any) {
        throw new Error(`加载 ${source} 失败: ${err.message}`, { cause: err });
      }
    }),
  );
}

/** 将多个文档合并为一个（带来源标题头，便于 LLM 区分） */
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
export { crawlSite } from './crawler.js';
export type { CrawlOptions } from './crawler.js';
export {
  scanDirectory,
  isDirectory,
  isSupportedFile,
  expandSources,
} from './directory.js';
export type { ScanOptions } from './directory.js';
