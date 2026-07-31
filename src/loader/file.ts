import { readFile } from 'node:fs/promises';
import type { LoadedDocument, SourceType } from '../types/index.js';

export async function loadFromFile(
  path: string,
  type: SourceType = 'text',
): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf-8');
  const title = path.split('/').pop() || path;
  return {
    source: path,
    type,
    content: raw,
    title,
  };
}
