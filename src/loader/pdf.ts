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
