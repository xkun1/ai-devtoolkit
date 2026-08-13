/**
 * 代码索引构建器
 *
 * 将扫描到的代码文件分块、提取关键词，构建倒排索引。
 */
import { join } from 'node:path';
import { readFile, writeFile, access } from 'node:fs/promises';
import type {
  CodeChunk,
  CodeSymbol,
  LanguageId,
  ScanCodeOptions,
  SearchIndex,
} from './types.js';
import { scanCodeFiles, extractSymbols } from './scanner.js';

export const INDEX_VERSION = '1.0.0';

/** 索引文件名 */
export const INDEX_FILENAME = '.doc2skill-index.json';

/** 默认分块参数 */
const DEFAULT_CHUNK_LINES = 80;
const DEFAULT_CHUNK_OVERLAP = 10;

/** 最小关键词长度 */
const MIN_KEYWORD_LENGTH = 2;

/** 停用词（英中文常见无用词） */
const STOP_WORDS = new Set([
  // 英文
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
  // 常见代码噪声词
  'val',
  'var',
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
    // 统计语言分布
    languageCounts[file.language] = (languageCounts[file.language] || 0) + 1;
    totalLines += file.lines;

    // 读取文件内容
    let content: string;
    try {
      content = await readFile(join(root, file.path), 'utf-8');
    } catch {
      continue;
    }

    // 提取符号
    if (extractSymbolsFlag) {
      const symbols = extractSymbols(content, file.language, file.path);
      allSymbols.push(...symbols);
    }

    // 分块
    const fileChunks = chunkCode(
      content,
      file.path,
      file.language,
      chunkLines,
      chunkOverlap,
    );

    // 为每个分块提取关键词并建立倒排索引
    for (const chunk of fileChunks) {
      chunks.push(chunk);

      // 关键词倒排索引
      for (const kw of chunk.keywords) {
        if (!invertedIndex[kw]) invertedIndex[kw] = [];
        invertedIndex[kw].push(chunk.id);
      }

      // 符号倒排索引
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

    // 提取关键词和符号
    const keywords = extractKeywords(chunkContent);
    const symbols = extractSymbolNames(chunkContent, language);

    chunks.push({
      id: `${baseName}__${chunkNum}`,
      file: filePath,
      language,
      startLine: startIdx + 1, // 1-based
      endLine: endIdx,
      content: chunkContent,
      keywords: [...new Set(keywords)],
      symbols: [...new Set(symbols)],
    });

    startIdx += step;
    chunkNum++;

    // 如果剩余内容不够一个完整分块且已经有一个分块了，就不再生成小碎片
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
  // 匹配所有标识符样的内容
  const identifierPattern = /[a-zA-Z_$][a-zA-Z0-9_$]+/g;
  let match: RegExpExecArray | null;

  while ((match = identifierPattern.exec(content)) !== null) {
    const word = match[0];

    // 跳过太短的
    if (word.length < MIN_KEYWORD_LENGTH) continue;

    // 拆分驼峰：myFunctionName -> [my, function, name]
    const camelParts = word
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(/\s+/);

    for (const part of camelParts) {
      const lower = part.toLowerCase();

      // 拆分蛇形：user_name -> [user, name]
      const snakeParts = lower.split(/[_\-.]+/);
      for (const sp of snakeParts) {
        if (sp.length < MIN_KEYWORD_LENGTH) continue;
        if (STOP_WORDS.has(sp)) continue;
        if (/^\d+$/.test(sp)) continue;
        keywords.push(sp);
      }
    }
  }

  // 2. 字符串字面量中的有意义的词
  const stringPattern = /['"`]([^'"`\n]{3,60})['"`]/g;
  while ((match = stringPattern.exec(content)) !== null) {
    const str = match[1];
    // 只保留看起来像有意义的标识符或消息的字符串
    if (
      /^[a-zA-Z][a-zA-Z0-9_\s-]+$/.test(str) &&
      !STOP_WORDS.has(str.toLowerCase())
    ) {
      const words = str.toLowerCase().split(/[\s-_]+/);
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

  // 4. 中文关键词提取（按字符组）
  const cjkPattern = /[\u4e00-\u9fff]{2,}/g;
  while ((match = cjkPattern.exec(content)) !== null) {
    keywords.push(match[0]);
  }

  return keywords;
}

/**
 * 从代码块中提取符号名
 */
function extractSymbolNames(content: string, language: LanguageId): string[] {
  const symbols = extractSymbols(content, language, '');
  return symbols.map((s) => s.name);
}

// ── 索引持久化 ──

/**
 * 保存索引到文件
 */
export async function saveIndex(
  index: SearchIndex,
  dir: string = process.cwd(),
): Promise<string> {
  const indexPath = join(dir, INDEX_FILENAME);
  const data = JSON.stringify(index);
  await writeFile(indexPath, data, 'utf-8');
  return indexPath;
}

/**
 * 加载已有索引
 *
 * @returns 索引对象，如果不存在或版本不匹配则返回 null
 */
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

/**
 * 检查索引是否存在
 */
export async function hasIndex(dir: string = process.cwd()): Promise<boolean> {
  const indexPath = join(dir, INDEX_FILENAME);
  try {
    await access(indexPath);
    return true;
  } catch {
    return false;
  }
}
