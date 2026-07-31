import { readFile } from 'node:fs/promises';
import type { LoadedDocument } from '../types/index.js';

/**
 * 从 .docx 文件提取文本内容（使用 mammoth）
 *
 * mammoth 将 Word 文档转为纯文本，保留语义化结构（标题、段落、列表）。
 */
export async function loadFromDocx(path: string): Promise<LoadedDocument> {
  const mammoth = await import('mammoth');
  const buffer = await readFile(path);
  const result = await mammoth.extractRawText({ buffer });

  const basename = path.split('/').pop() || path;
  const title = basename.replace(/\.[^.]+$/, '');
  const h1 = result.value.match(/^#\s+(.+)$/m)?.[1]?.trim();

  return {
    source: path,
    type: 'text',
    content: result.value,
    title: h1 || title,
    meta: {
      format: 'docx',
      messages: result.messages?.length ? String(result.messages.length) : '0',
    },
  };
}

/**
 * 从 Buffer 提取 DOCX 文本（Web UI 文件上传用）
 * 与 loadFromDocx 逻辑一致，但接收 Buffer 而非文件路径
 */
export async function extractDocxFromBuffer(
  buffer: Buffer,
  fileName?: string,
): Promise<{ content: string; title: string }> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });

  const title = (fileName || 'document').replace(/\.[^.]+$/, '');
  const h1 = result.value.match(/^#\s+(.+)$/m)?.[1]?.trim();

  return {
    content: result.value,
    title: h1 || title,
  };
}
