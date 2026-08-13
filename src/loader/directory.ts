import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** 支持的文档扩展名 */
const SUPPORTED_EXTENSIONS = [
  '.md',
  '.markdown',
  '.pdf',
  '.docx',
  '.doc',
  '.html',
  '.htm',
  '.txt',
  '.text',
  '.rst',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
];

/** 应忽略的目录名 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '.docusaurus',
  '__pycache__',
]);

/** 判断路径是否是受支持的文档文件 */
export function isSupportedFile(filename: string): boolean {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] ?? '';
  return SUPPORTED_EXTENSIONS.includes(ext);
}

/** 判断路径是否是目录 */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

export interface ScanOptions {
  /** 最大递归深度（默认 5） */
  maxDepth?: number;
  /** 自定义忽略的目录名（会与内置忽略列表合并） */
  ignoreDirs?: string[];
}

/** 递归扫描目录，返回所有受支持的文档文件路径 */
export async function scanDirectory(
  dirPath: string,
  options: ScanOptions = {},
): Promise<string[]> {
  const { maxDepth = 5, ignoreDirs = [] } = options;
  const ignored = new Set([...IGNORED_DIRS, ...ignoreDirs]);
  const results: string[] = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && isSupportedFile(entry.name)) {
        if (entry.name.startsWith('.')) continue;
        results.push(fullPath);
      }
    }
  }

  await walk(dirPath, 0);
  return results;
}

/**
 * 展开来源列表中的目录：目录被递归扫描为文件列表，普通路径原样保留。
 * 返回展开后的文件列表 + 是否包含目录的标记。
 */
export async function expandSources(
  sources: string[],
  options: ScanOptions = {},
): Promise<{ files: string[]; hadDirectory: boolean }> {
  const files: string[] = [];
  let hadDirectory = false;

  for (const source of sources) {
    if (await isDirectory(source)) {
      hadDirectory = true;
      const scanned = await scanDirectory(source, options);
      files.push(...scanned);
    } else {
      files.push(source);
    }
  }

  return { files, hadDirectory };
}
