import { readFile } from 'node:fs/promises';
import type { LoadedDocument } from '../types/index.js';
import { extractFromHtml } from './readability.js';

export async function loadFromHtml(path: string): Promise<LoadedDocument> {
  const html = await readFile(path, 'utf-8');
  const { content, title, meta } = await extractFromHtml(html);
  return {
    source: path,
    type: 'html',
    content,
    title: title || path.split('/').pop() || 'Untitled HTML',
    meta,
  };
}
