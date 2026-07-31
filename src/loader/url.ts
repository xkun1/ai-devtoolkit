import type { LoadedDocument } from '../types/index.js';
import { extractContent } from './readability.js';

export async function loadFromUrl(url: string): Promise<LoadedDocument> {
  const { content, title, meta } = await extractContent(url);
  return {
    source: url,
    type: 'url',
    content,
    title,
    url,
    meta,
  };
}
