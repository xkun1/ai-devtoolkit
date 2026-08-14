/**
 * 代码索引构建器
 *
 * 将扫描到的代码文件分块、提取关键词，构建倒排索引。
 * 支持全量构建 (buildIndex) 与增量更新 (updateIndex)。
 */
import { join } from 'node:path';
import { readFile, access, chmod } from 'node:fs/promises';
import type {
  CodeChunk,
  CodeSymbol,
  LanguageId,
  ScanCodeOptions,
  SearchIndex,
} from './types.js';
import { scanCodeFiles, extractSymbols } from './scanner.js';
import { writeFileAtomic } from '../utils/atomic-write.js';

export const INDEX_VERSION = '1.0.0';

/** 索引文件名 */
export const INDEX_FILENAME = '.devtoolkit-index.json';

/** 默认分块参数 */
const DEFAULT_CHUNK_LINES = 80;
const DEFAULT_CHUNK_OVERLAP = 10;

/** 最小关键词长度 */
const MIN_KEYWORD_LENGTH = 2;

/** 停用词（英中文常见无用词） */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'can',
  'need',
  'shall',
  'if',
  'then',
  'else',
  'for',
  'while',
  'this',
  'that',
  'these',
  'those',
  'with',
  'from',
  'into',
  'onto',
  'about',
  'than',
  'but',
  'not',
  'no',
  'yes',
  'and',
  'or',
  'as',
  'at',
  'by',
  'in',
  'of',
  'on',
  'to',
  'up',
  'out',
  'off',
  'all',
  'any',
  'some',
  'each',
  'every',
  'both',
  'few',
  'more',
  'most',
  'other',
  'such',
  'only',
  'own',
  'same',
  'so',
  'too',
  'very',
  'just',
  'now',
  'return',
  'import',
  'export',
  'const',
  'let',
  'var',
  'function',
  'class',
  'new',
  'try',
  'catch',
  'throw',
  'case',
  'break',
  'continue',
  'default',
  'public',
  'private',
  'protected',
  'static',
  'final',
  'abstract',
  'void',
  'true',
  'false',
  'null',
  'undefined',
  'none',
  'self',
  'super',
  'val',
  'def',
  'fun',
  'fn',
  'use',
  'mod',
  'mut',
  'ref',
  'get',
  'set',
]);

/**
 * 构建完整搜索索引
 *
 * @param options 扫描选项
 * @returns 完整的搜索索引
 */
export async function buildIndex(
  options: ScanCodeOptions = {},
): Promise<SearchIndex> {
  const root = options.root || process.cwd();
  const chunkLines = options.chunkLines ?? DEFAULT_CHUNK_LINES;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const extractSymbolsFlag = options.extractSymbols ?? true;

  // Step 1: 扫描文件
  const files = await scanCodeFiles(options);

  const chunks: CodeChunk[] = [];
  const allSymbols: CodeSymbol[] = [];
  const invertedIndex: Record<string, string[]> = Object.create(null);
  const symbolIndex: Record<string, string[]> = Object.create(null);
  const languageCounts: Record<string, number> = {};
  let totalLines = 0;

  // Step 2: 逐文件处理
  for (const file of files) {
    languageCounts[file.language] = (languageCounts[file.language] || 0) + 1;
    totalLines += file.lines;

    let content: string;
    try {
      content = await readFile(join(root, file.path), 'utf-8');
    } catch {
      continue;
    }

    if (extractSymbolsFlag) {
      const symbols = extractSymbols(content, file.language, file.path);
      allSymbols.push(...symbols);
    }

    const fileChunks = chunkCode(
      content,
      file.path,
      file.language,
      chunkLines,
      chunkOverlap,
    );

    for (const chunk of fileChunks) {
      chunks.push(chunk);

      for (const kw of chunk.keywords) {
        if (!invertedIndex[kw]) invertedIndex[kw] = [];
        invertedIndex[kw].push(chunk.id);
      }

      for (const sym of chunk.symbols) {
        const lowerSym = sym.toLowerCase();
        if (!symbolIndex[lowerSym]) symbolIndex[lowerSym] = [];
        symbolIndex[lowerSym].push(chunk.id);
      }
    }
  }

  return {
    version: INDEX_VERSION,
    projectRoot: root,
    createdAt: Date.now(),
    files,
    chunks,
    symbols: allSymbols,
    invertedIndex,
    symbolIndex,
    stats: {
      totalFiles: files.length,
      totalLines,
      totalChunks: chunks.length,
      totalSymbols: allSymbols.length,
      totalKeywords: Object.keys(invertedIndex).length,
      languages: languageCounts,
    },
  };
}

/**
 * 增量更新已有索引（仅重扫变更/新增文件，移除删除文件）
 */
export async function updateIndex(
  existingIndex: SearchIndex,
  options: ScanCodeOptions = {},
): Promise<SearchIndex> {
  const root = options.root || existingIndex.projectRoot;
  const chunkLines = options.chunkLines ?? DEFAULT_CHUNK_LINES;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
  const extractSymbolsFlag = options.extractSymbols ?? true;

  const currentFiles = await scanCodeFiles({ ...options, root });
  const oldFileMap = new Map(existingIndex.files.map((f) => [f.path, f]));
  const curFileMap = new Map(currentFiles.map((f) => [f.path, f]));

  // 找出变更或新增的文件
  const changedPaths = new Set<string>();
  for (const [path, curFile] of curFileMap.entries()) {
    const oldFile = oldFileMap.get(path);
    if (
      !oldFile ||
      oldFile.lastModified !== curFile.lastModified ||
      oldFile.size !== curFile.size
    ) {
      changedPaths.add(path);
    }
  }

  // 找出已删除的文件
  const deletedPaths = new Set<string>();
  for (const path of oldFileMap.keys()) {
    if (!curFileMap.has(path)) {
      deletedPaths.add(path);
    }
  }

  // 如果没有文件变动，直接返回
  if (changedPaths.size === 0 && deletedPaths.size === 0) {
    return existingIndex;
  }

  // 保留未变动文件的 chunks 和 symbols
  const retainedChunks = existingIndex.chunks.filter(
    (c) => !changedPaths.has(c.file) && !deletedPaths.has(c.file),
  );
  const retainedSymbols = existingIndex.symbols.filter(
    (s) => !changedPaths.has(s.file) && !deletedPaths.has(s.file),
  );

  const newChunks: CodeChunk[] = [];
  const newSymbols: CodeSymbol[] = [];

  for (const path of changedPaths) {
    const file = curFileMap.get(path)!;
    let content: string;
    try {
      content = await readFile(join(root, path), 'utf-8');
    } catch {
      continue;
    }

    if (extractSymbolsFlag) {
      const symbols = extractSymbols(content, file.language, path);
      newSymbols.push(...symbols);
    }

    const fileChunks = chunkCode(
      content,
      path,
      file.language,
      chunkLines,
      chunkOverlap,
    );
    newChunks.push(...fileChunks);
  }

  const allChunks = [...retainedChunks, ...newChunks];
  const allSymbols = [...retainedSymbols, ...newSymbols];

  // 重建倒排索引
  const invertedIndex: Record<string, string[]> = Object.create(null);
  const symbolIndex: Record<string, string[]> = Object.create(null);
  const languageCounts: Record<string, number> = {};
  let totalLines = 0;

  for (const file of currentFiles) {
    languageCounts[file.language] = (languageCounts[file.language] || 0) + 1;
    totalLines += file.lines;
  }

  for (const chunk of allChunks) {
    for (const kw of chunk.keywords) {
      if (!invertedIndex[kw]) invertedIndex[kw] = [];
      invertedIndex[kw].push(chunk.id);
    }
    for (const sym of chunk.symbols) {
      const lowerSym = sym.toLowerCase();
      if (!symbolIndex[lowerSym]) symbolIndex[lowerSym] = [];
      symbolIndex[lowerSym].push(chunk.id);
    }
  }

  return {
    version: INDEX_VERSION,
    projectRoot: root,
    createdAt: Date.now(),
    files: currentFiles,
    chunks: allChunks,
    symbols: allSymbols,
    invertedIndex,
    symbolIndex,
    stats: {
      totalFiles: currentFiles.length,
      totalLines,
      totalChunks: allChunks.length,
      totalSymbols: allSymbols.length,
      totalKeywords: Object.keys(invertedIndex).length,
      languages: languageCounts,
    },
  };
}

/**
 * 将代码文件内容按行分块
 */
function chunkCode(
  content: string,
  filePath: string,
  language: LanguageId,
  chunkLines: number,
  overlap: number,
): CodeChunk[] {
  const lines = content.split('\n');
  if (lines.length === 0) return [];

  const chunks: CodeChunk[] = [];
  const step = Math.max(1, chunkLines - overlap);
  const baseName = filePath.replace(/[^a-zA-Z0-9]/g, '_');

  let startIdx = 0;
  let chunkNum = 0;

  while (startIdx < lines.length) {
    const endIdx = Math.min(startIdx + chunkLines, lines.length);
    const chunkContent = lines.slice(startIdx, endIdx).join('\n');

    const keywords = extractKeywords(chunkContent);
    const symbols = extractSymbolNames(chunkContent, language);

    chunks.push({
      id: `${baseName}__${chunkNum}`,
      file: filePath,
      language,
      startLine: startIdx + 1,
      endLine: endIdx,
      content: chunkContent,
      keywords: [...new Set(keywords)],
      symbols: [...new Set(symbols)],
    });

    startIdx += step;
    chunkNum++;

    if (endIdx >= lines.length) break;
  }

  return chunks;
}

/**
 * 从代码文本中提取关键词（分词 + 过滤）
 */
function extractKeywords(content: string): string[] {
  const keywords: string[] = [];

  // 1. 标识符分词（驼峰拆分 + 蛇形拆分）
  const identifierPattern = /[a-zA-Z_$][a-zA-Z0-9_$]+/g;
  let match: RegExpExecArray | null;

  while ((match = identifierPattern.exec(content)) !== null) {
    const word = match[0];
    if (word.length < MIN_KEYWORD_LENGTH) continue;

    const camelParts = word
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/);

    for (const part of camelParts) {
      const lower = part.toLowerCase();
      const snakeParts = lower.split(/[_\-.]+/);
      for (const sp of snakeParts) {
        if (sp.length < MIN_KEYWORD_LENGTH) continue;
        if (STOP_WORDS.has(sp)) continue;
        if (/^\d+$/.test(sp)) continue;
        keywords.push(sp);
      }
    }
  }

  // 2. 字符串字面量中的词
  const stringPattern = /['"`]([^'"`\n]{3,60})['"`]/g;
  while ((match = stringPattern.exec(content)) !== null) {
    const str = match[1];
    if (
      /^[a-zA-Z][a-zA-Z0-9_\s-]+$/.test(str) &&
      !STOP_WORDS.has(str.toLowerCase())
    ) {
      const words = str.toLowerCase().split(/[\s_-]+/);
      for (const w of words) {
        if (
          w.length >= MIN_KEYWORD_LENGTH &&
          !STOP_WORDS.has(w) &&
          !/^\d+$/.test(w)
        ) {
          keywords.push(w);
        }
      }
    }
  }

  // 3. 注释中的关键词
  const commentPattern = /(?:\/\/|#|<!--|\/\*)\s*(.+?)(?:\n|\*\/|-->)/g;
  while ((match = commentPattern.exec(content)) !== null) {
    const comment = match[1];
    const words = comment.match(/[a-zA-Z][a-zA-Z0-9]+/g);
    if (words) {
      for (const w of words) {
        const lower = w.toLowerCase();
        if (
          lower.length >= MIN_KEYWORD_LENGTH &&
          !STOP_WORDS.has(lower) &&
          !/^\d+$/.test(lower)
        ) {
          keywords.push(lower);
        }
      }
    }
  }

  // 4. 中文关键词提取（整词 + 2-gram）
  const cjkPattern = /[\u4e00-\u9fff]+/g;
  while ((match = cjkPattern.exec(content)) !== null) {
    const cjkWord = match[0];
    if (cjkWord.length >= 2) {
      keywords.push(cjkWord);
      for (let i = 0; i < cjkWord.length - 1; i++) {
        keywords.push(cjkWord.slice(i, i + 2));
      }
    }
  }

  return keywords;
}

/** 从代码块中提取符号名 */
function extractSymbolNames(content: string, language: LanguageId): string[] {
  const symbols = extractSymbols(content, language, '');
  return symbols.map((s) => s.name);
}

// ── 索引持久化 ──

export async function saveIndex(
  index: SearchIndex,
  dir: string = process.cwd(),
): Promise<string> {
  const indexPath = join(dir, INDEX_FILENAME);
  const data = JSON.stringify(index);
  await ensureIndexIgnored(dir);
  await writeFileAtomic(indexPath, data);
  try {
    await chmod(indexPath, 0o600);
  } catch {
    // Windows 等平台可能不支持 POSIX 权限位，不影响索引使用。
  }
  return indexPath;
}

async function ensureIndexIgnored(dir: string): Promise<void> {
  const ignorePath = join(dir, '.gitignore');
  let content = '';
  try {
    content = await readFile(ignorePath, 'utf-8');
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
  const entries = new Set(
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  if (entries.has(INDEX_FILENAME) || entries.has(`/${INDEX_FILENAME}`)) return;

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await writeFileAtomic(
    ignorePath,
    `${content}${separator}${INDEX_FILENAME}\n`,
  );
}

export async function loadIndex(
  dir: string = process.cwd(),
): Promise<SearchIndex | null> {
  const indexPath = join(dir, INDEX_FILENAME);
  try {
    await access(indexPath);
  } catch {
    return null;
  }

  try {
    const data = await readFile(indexPath, 'utf-8');
    const index = JSON.parse(data) as SearchIndex;
    if (index.version !== INDEX_VERSION) {
      return null;
    }
    return index;
  } catch {
    return null;
  }
}

export async function hasIndex(dir: string = process.cwd()): Promise<boolean> {
  const indexPath = join(dir, INDEX_FILENAME);
  try {
    await access(indexPath);
    return true;
  } catch {
    return false;
  }
}
