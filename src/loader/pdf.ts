import { readFile } from 'node:fs/promises';
import type { LoadedDocument } from '../types/index.js';

export async function loadFromPdf(path: string): Promise<LoadedDocument> {
  const pdfParse = (await import('pdf-parse')).default;
  const buffer = await readFile(path);
  const data = await pdfParse(buffer);
  return {
    source: path,
    type: 'pdf',
    content: data.text,
    title: data.info?.Title || path.split('/').pop() || 'Untitled PDF',
    meta: {
      pages: String(data.numpages),
      author: data.info?.Author || '',
    },
  };
}

/**
 * 从 Buffer 提取 PDF 文本（Web UI 文件上传用）
 * 与 loadFromPdf 逻辑一致，但接收 Buffer 而非文件路径
 */
export async function extractPdfFromBuffer(
  buffer: Buffer,
  fileName?: string,
): Promise<{ content: string; title: string }> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  const title =
    data.info?.Title || (fileName || 'document').replace(/\.[^.]+$/, '');
  return {
    content: data.text,
    title,
  };
}
