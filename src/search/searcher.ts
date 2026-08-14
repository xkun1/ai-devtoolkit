/**
 * 代码搜索引擎
 *
 * 基于 TF-IDF + 多路召回（关键词/符号/路径/模糊匹配）进行搜索。
 * 支持结构化语法过滤（path:xxx, lang:xxx, kind:xxx）与细粒度中文分词。
 * 不依赖外部服务，纯本地计算。
 */
import type {
  SearchIndex,
  SearchOptions,
  SearchResult,
  CodeChunk,
} from './types.js';

interface QueryFilters {
  cleanQuery: string;
  pathFilter?: string;
  langFilter?: string;
  kindFilter?: string;
}

/** 搜索引擎类 */
export class CodeSearcher {
  private index: SearchIndex;
  private chunkMap: Map<string, CodeChunk>;
  private chunkCount: number;

  constructor(index: SearchIndex) {
    this.index = index;
    this.chunkMap = new Map();
    for (const chunk of index.chunks) {
      this.chunkMap.set(chunk.id, chunk);
    }
    this.chunkCount = index.chunks.length;
  }

  /** 解析查询中的结构化过滤语法 (如 path:src/ lang:ts kind:class) */
  private parseQueryFilters(rawQuery: string): QueryFilters {
    let clean = rawQuery;
    let pathFilter: string | undefined;
    let langFilter: string | undefined;
    let kindFilter: string | undefined;

    // path: / file:
    const pathMatch = clean.match(/(?:path|file):(S+)/i);
    if (pathMatch) {
      pathFilter = pathMatch[1].toLowerCase();
      clean = clean.replace(pathMatch[0], ' ');
    }

    // lang:
    const langMatch = clean.match(/lang:(S+)/i);
    if (langMatch) {
      const rawLang = langMatch[1].toLowerCase();
      const langAlias: Record<string, string> = {
        ts: 'typescript',
        js: 'javascript',
        py: 'python',
        rs: 'rust',
      };
      langFilter = langAlias[rawLang] || rawLang;
      clean = clean.replace(langMatch[0], ' ');
    }

    // kind:
    const kindMatch = clean.match(/kind:(S+)/i);
    if (kindMatch) {
      kindFilter = kindMatch[1].toLowerCase();
      clean = clean.replace(kindMatch[0], ' ');
    }

    return {
      cleanQuery: clean.trim(),
      pathFilter,
      langFilter,
      kindFilter,
    };
  }

  /**
   * 搜索代码
   *
   * 多路召回 + 加权打分：
   * 1. 关键词匹配（TF-IDF）
   * 2. 符号名匹配（精确/前缀/包含）
   * 3. 文件路径匹配
   * 4. 全文模糊匹配（fallback）
   * 5. 结构化过滤器筛选（path / lang / kind）
   */
  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;
    const searchSymbols = options.searchSymbols ?? true;
    const searchFilePath = options.searchFilePath ?? true;

    const { cleanQuery, pathFilter, langFilter, kindFilter } =
      this.parseQueryFilters(query);
    const effectiveQuery = cleanQuery || query;

    const queryTokens = this.tokenize(effectiveQuery);
    if (queryTokens.length === 0 && !query.trim()) return [];

    const scoreMap = new Map<
      string,
      { score: number; keywords: Set<string>; symbols: Set<string> }
    >();

    // ── 1. 关键词倒排索引匹配（TF-IDF 加权）──
    for (const token of queryTokens) {
      const lowerToken = token.toLowerCase();

      // 精确匹配
      const chunkIds = this.index.invertedIndex[lowerToken];
      if (chunkIds) {
        const idf = Math.log(1 + this.chunkCount / chunkIds.length);
        for (const chunkId of chunkIds) {
          this.addScore(scoreMap, chunkId, idf, lowerToken, '');
        }
      }

      // 前缀/包含匹配（宽松召回）
      for (const [indexKey, ids] of Object.entries(this.index.invertedIndex)) {
        if (indexKey === lowerToken) continue;
        if (indexKey.includes(lowerToken) || lowerToken.includes(indexKey)) {
          const idf = Math.log(1 + this.chunkCount / ids.length) * 0.5;
          for (const chunkId of ids) {
            this.addScore(scoreMap, chunkId, idf, indexKey, '');
          }
        }
      }
    }

    // ── 2. 符号名匹配 ──
    if (searchSymbols) {
      for (const token of queryTokens) {
        const lowerToken = token.toLowerCase();
        const symChunkIds = this.index.symbolIndex[lowerToken];
        if (symChunkIds) {
          for (const chunkId of symChunkIds) {
            this.addScore(scoreMap, chunkId, 2.0, '', lowerToken);
          }
        }
        for (const [symKey, ids] of Object.entries(this.index.symbolIndex)) {
          if (symKey === lowerToken) continue;
          if (symKey.includes(lowerToken)) {
            for (const chunkId of ids) {
              this.addScore(scoreMap, chunkId, 1.0, '', symKey);
            }
          }
        }
      }
    }

    // ── 3. 文件路径匹配 ──
    if (searchFilePath && queryTokens.length > 0) {
      for (const chunk of this.index.chunks) {
        const lowerPath = chunk.file.toLowerCase();
        for (const token of queryTokens) {
          const lowerToken = token.toLowerCase();
          if (lowerPath.includes(lowerToken)) {
            this.addScore(scoreMap, chunk.id, 0.5, '', '');
          }
        }
      }
    }

    // ── 4. 全文 fallback ──
    if (scoreMap.size === 0 && effectiveQuery.trim()) {
      const lowerQuery = effectiveQuery.toLowerCase();
      const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length >= 1);

      for (const chunk of this.index.chunks) {
        const lowerContent = chunk.content.toLowerCase();
        let matchCount = 0;
        for (const w of queryWords) {
          if (lowerContent.includes(w)) matchCount++;
        }
        if (matchCount > 0) {
          this.addScore(scoreMap, chunk.id, matchCount * 0.3, '', '');
        }
      }
    }

    // ── 过滤与打分 ──
    const maxScore = Math.max(
      ...Array.from(scoreMap.values()).map((v) => v.score),
      0.001,
    );

    const results: SearchResult[] = [];
    for (const [chunkId, { score, keywords, symbols }] of scoreMap) {
      const chunk = this.chunkMap.get(chunkId);
      if (!chunk) continue;

      if (pathFilter && !chunk.file.toLowerCase().includes(pathFilter)) {
        continue;
      }
      if (langFilter && chunk.language.toLowerCase() !== langFilter) {
        continue;
      }
      if (kindFilter) {
        const hasKind = this.index.symbols.some(
          (s) =>
            s.file === chunk.file &&
            s.kind.toLowerCase() === kindFilter &&
            s.line >= chunk.startLine &&
            s.line <= chunk.endLine,
        );
        if (!hasKind) continue;
      }

      const normalizedScore = score / maxScore;
      if (normalizedScore < minScore) continue;

      results.push({
        chunk,
        score: normalizedScore,
        matchedKeywords: [...keywords],
        matchedSymbols: [...symbols],
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  private addScore(
    scoreMap: Map<
      string,
      { score: number; keywords: Set<string>; symbols: Set<string> }
    >,
    chunkId: string,
    score: number,
    keyword: string,
    symbol: string,
  ): void {
    if (!scoreMap.has(chunkId)) {
      scoreMap.set(chunkId, {
        score: 0,
        keywords: new Set(),
        symbols: new Set(),
      });
    }
    const entry = scoreMap.get(chunkId)!;
    entry.score += score;
    if (keyword) entry.keywords.add(keyword);
    if (symbol) entry.symbols.add(symbol);
  }

  private tokenize(query: string): string[] {
    const tokens: string[] = [];

    const identifierPattern = /[a-zA-Z_$][a-zA-Z0-9_$]+/g;
    let match: RegExpExecArray | null;

    while ((match = identifierPattern.exec(query)) !== null) {
      const word = match[0];
      const parts = word
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
        .split(/\s+/);

      for (const part of parts) {
        const lower = part.toLowerCase();
        const snakeParts = lower.split(/[_\-.]+/);
        for (const sp of snakeParts) {
          if (sp.length >= 2) tokens.push(sp);
        }
      }
    }

    const cjkPattern = /[\u4e00-\u9fff]+/g;
    while ((match = cjkPattern.exec(query)) !== null) {
      const cjkWord = match[0];
      if (cjkWord.length >= 2) {
        tokens.push(cjkWord);
        for (let i = 0; i < cjkWord.length - 1; i++) {
          tokens.push(cjkWord.slice(i, i + 2));
        }
      } else if (cjkWord.length === 1) {
        tokens.push(cjkWord);
      }
    }

    return [...new Set(tokens)];
  }
}

export function searchCode(
  index: SearchIndex,
  query: string,
  options?: SearchOptions,
): SearchResult[] {
  const searcher = new CodeSearcher(index);
  return searcher.search(query, options);
}
