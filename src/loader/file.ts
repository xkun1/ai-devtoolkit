import { readFile } from 'node:fs/promises';
import type { LoadedDocument, SourceType } from '../types/index.js';

export async function loadFromFile(
  path: string,
  type: SourceType = 'text',
): Promise<LoadedDocument> {
  const raw = await readFile(path, 'utf-8');
  // 标题优先取正文第一个 # 标题（更准确），回退到文件名去扩展名
  const h1 = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const basename = path.split('/').pop() || path;
  const title = h1 || basename.replace(/\.[^.]+$/, '') || basename;
  return {
    source: path,
    type,
    content: raw,
    title,
  };
}
