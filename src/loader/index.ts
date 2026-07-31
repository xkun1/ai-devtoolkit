import type { LoadedDocument, SourceType } from '../types/index.js';
import { loadFromUrl } from './url.js';
import { loadFromPdf } from './pdf.js';
import { loadFromFile } from './file.js';

/** 判断 source 类型 */
export function detectSourceType(source: string): SourceType {
  if (/^https?:\/\//i.test(source)) return 'url';
  if (/\.pdf$/i.test(source)) return 'pdf';
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
    default:
      return loadFromFile(source, type);
  }
}

export { loadFromUrl, loadFromPdf, loadFromFile };
