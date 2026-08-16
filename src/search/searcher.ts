/**
 * 智能混合代码搜索引擎 (Hybrid Code Search & Ranking Engine)
 *
 * 融合 BM25 词频与逆文档频率模型、符号倒排索引精准召回、
 * 以及基于轻量级 Subword N-Gram TF-IDF 向量空间模型的余弦语义相似度 (Cosine Semantic Similarity)。
 * 具备开发者领域近义词与概念自动扩展，纯本地计算，零外部网络与模型依赖。
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

/** 领域近义词与概念映射表 (Domain Semantic Concepts) */
const DOMAIN_CONCEPT_MAP: Record<string, string[]> = {
  auth: [
    'login',
    'token',
    'jwt',
    'authenticate',
    'permission',
    'session',
    'user',
    'oauth',
    'credential',
    'authorizer',
  ],
  login: [
    'auth',
    'authenticate',
    'signin',
    'token',
    'session',
    'password',
    'user',
  ],
  user: ['account', 'member', 'profile', 'users', 'auth'],
  db: [
    'database',
    'sql',
    'query',
    'repository',
    'dao',
    'model',
    'schema',
    'entity',
    'orm',
    'store',
  ],
  database: [
    'sql',
    'query',
    'repository',
    'dao',
    'model',
    'schema',
    'entity',
    'orm',
    'db',
  ],
  pay: [
    'payment',
    'order',
    'refund',
    'checkout',
    'money',
    'price',
    'transaction',
  ],
  payment: [
    'order',
    'refund',
    'checkout',
    'money',
    'price',
    'transaction',
    'pay',
  ],
  net: [
    'network',
    'http',
    'request',
    'response',
    'fetch',
    'api',
    'endpoint',
    'client',
    'server',
    'url',
  ],
  http: [
    'request',
    'response',
    'fetch',
    'api',
    'endpoint',
    'client',
    'server',
    'url',
    'get',
    'post',
  ],
  log: ['logger', 'logging', 'info', 'warn', 'error', 'debug', 'trace'],
  logger: ['log', 'logging', 'info', 'warn', 'error', 'debug', 'trace'],
  config: ['setting', 'option', 'env', 'constant', 'properties', 'cfg'],
  err: ['error', 'exception', 'fail', 'catch', 'throw', 'reject', 'bug'],
  error: ['exception', 'fail', 'catch', 'throw', 'reject', 'err'],
  route: ['router', 'path', 'url', 'controller', 'handler', 'dispatch'],
  router: ['route', 'path', 'url', 'controller', 'handler', 'dispatch'],
  graph: [
    'topology',
    'dependency',
    'node',
    'edge',
    'impact',
    'mermaid',
    'tree',
  ],
  cache: ['store', 'redis', 'mem', 'cached', 'hit', 'lru', 'buffer'],
};

/** 搜索引擎类 */
export class CodeSearcher {
  private index: SearchIndex;
  private chunkMap: Map<string, CodeChunk>;
  private chunkCount: number;
  private avgChunkLength: number;
  private chunkDocLengths: Map<string, number>;
  private chunkTermFrequencies: Map<string, Map<string, number>>;
  private chunkVectors: Map<string, Map<string, number>>;
  private chunkVectorNorms: Map<string, number>;

  constructor(index: SearchIndex) {
    this.index = index;
    this.chunkMap = new Map();
    this.chunkCount = index.chunks.length;
    this.chunkDocLengths = new Map();
    this.chunkTermFrequencies = new Map();
    this.chunkVectors = new Map();
    this.chunkVectorNorms = new Map();

    let totalLength = 0;

    for (const chunk of index.chunks) {
      this.chunkMap.set(chunk.id, chunk);

      const tokens = this.tokenize(chunk.content);
      const docLen = Math.max(1, tokens.length);
      this.chunkDocLengths.set(chunk.id, docLen);
      totalLength += docLen;

      const tfMap = new Map<string, number>();
      for (const t of tokens) {
        const lower = t.toLowerCase();
        tfMap.set(lower, (tfMap.get(lower) || 0) + 1);
      }
      this.chunkTermFrequencies.set(chunk.id, tfMap);

      const vector = new Map<string, number>();
      let normSq = 0;
      for (const [term, freq] of tfMap.entries()) {
        const invList = index.invertedIndex[term];
        const df = invList ? invList.length : 1;
        const idf = Math.log(1 + (this.chunkCount - df + 0.5) / (df + 0.5));
        const w = (1 + Math.log(freq)) * Math.max(0.1, idf);
        vector.set(term, w);
        normSq += w * w;
      }
      this.chunkVectors.set(chunk.id, vector);
      this.chunkVectorNorms.set(chunk.id, Math.sqrt(normSq) || 1);
    }

    this.avgChunkLength =
      this.chunkCount > 0 ? totalLength / this.chunkCount : 50;
  }

  private parseQueryFilters(rawQuery: string): QueryFilters {
    let clean = rawQuery;
    let pathFilter: string | undefined;
    let langFilter: string | undefined;
    let kindFilter: string | undefined;

    const pathMatch = clean.match(/(?:path|file):(\S+)/i);
    if (pathMatch) {
      pathFilter = pathMatch[1].toLowerCase();
      clean = clean.replace(pathMatch[0], ' ');
    }

    const langMatch = clean.match(/lang:(\S+)/i);
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

    const kindMatch = clean.match(/kind:(\S+)/i);
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

  search(query: string, options: SearchOptions = {}): SearchResult[] {
    const limit = options.limit ?? 10;
    const minScore = options.minScore ?? 0;
    const searchSymbols = options.searchSymbols ?? true;
    const searchFilePath = options.searchFilePath ?? true;
    const mode = options.mode ?? 'hybrid';
    const semanticWeight =
      options.semanticWeight ??
      (mode === 'exact' ? 0 : mode === 'semantic' ? 0.65 : 0.35);

    const { cleanQuery, pathFilter, langFilter, kindFilter } =
      this.parseQueryFilters(query);
    const effectiveQuery = cleanQuery || query;

    const queryTokens = this.tokenize(effectiveQuery);
    if (queryTokens.length === 0 && !query.trim()) return [];

    const expandedTokens = new Map<string, number>();
    for (const token of queryTokens) {
      const lower = token.toLowerCase();
      expandedTokens.set(lower, 1.0);

      if (mode !== 'exact') {
        const synonyms = DOMAIN_CONCEPT_MAP[lower];
        if (synonyms) {
          for (const syn of synonyms) {
            if (!expandedTokens.has(syn)) {
              expandedTokens.set(syn, 0.45);
            }
          }
        }
      }
    }

    const bm25Scores = new Map<string, number>();
    const vectorScores = new Map<string, number>();
    const symbolScores = new Map<string, number>();
    const pathScores = new Map<string, number>();
    const matchKeywordsMap = new Map<string, Set<string>>();
    const matchSymbolsMap = new Map<string, Set<string>>();

    const k1 = 1.2;
    const b = 0.75;

    for (const [token, weight] of expandedTokens.entries()) {
      const chunkIds = this.index.invertedIndex[token];
      if (chunkIds && chunkIds.length > 0) {
        const df = chunkIds.length;
        const idf = Math.log(1 + (this.chunkCount - df + 0.5) / (df + 0.5));

        for (const chunkId of chunkIds) {
          const tfMap = this.chunkTermFrequencies.get(chunkId);
          const tf = tfMap ? tfMap.get(token) || 1 : 1;
          const docLen =
            this.chunkDocLengths.get(chunkId) || this.avgChunkLength;

          const bm25Val =
            idf *
            ((tf * (k1 + 1)) /
              (tf + k1 * (1 - b + b * (docLen / this.avgChunkLength)))) *
            weight;

          bm25Scores.set(chunkId, (bm25Scores.get(chunkId) || 0) + bm25Val);

          if (!matchKeywordsMap.has(chunkId)) {
            matchKeywordsMap.set(chunkId, new Set());
          }
          matchKeywordsMap.get(chunkId)!.add(token);
        }
      }

      for (const [indexKey, ids] of Object.entries(this.index.invertedIndex)) {
        if (indexKey === token) continue;
        if (indexKey.includes(token) || token.includes(indexKey)) {
          const idf = Math.log(1 + this.chunkCount / ids.length) * 0.4 * weight;
          for (const chunkId of ids) {
            bm25Scores.set(chunkId, (bm25Scores.get(chunkId) || 0) + idf);
            if (!matchKeywordsMap.has(chunkId)) {
              matchKeywordsMap.set(chunkId, new Set());
            }
            matchKeywordsMap.get(chunkId)!.add(indexKey);
          }
        }
      }
    }

    if (semanticWeight > 0) {
      const queryVec = new Map<string, number>();
      let queryNormSq = 0;
      for (const [term, weight] of expandedTokens.entries()) {
        const invList = this.index.invertedIndex[term];
        const df = invList ? invList.length : 1;
        const idf = Math.log(1 + (this.chunkCount - df + 0.5) / (df + 0.5));
        const w = weight * Math.max(0.2, idf);
        queryVec.set(term, w);
        queryNormSq += w * w;
      }
      const queryNorm = Math.sqrt(queryNormSq) || 1;

      const candidateIds =
        bm25Scores.size > 0
          ? Array.from(bm25Scores.keys())
          : this.index.chunks.map((c) => c.id);

      for (const chunkId of candidateIds) {
        const chunkVec = this.chunkVectors.get(chunkId);
        const chunkNorm = this.chunkVectorNorms.get(chunkId) || 1;
        if (!chunkVec) continue;

        let dotProduct = 0;
        for (const [qTerm, qWeight] of queryVec.entries()) {
          const cWeight = chunkVec.get(qTerm);
          if (cWeight) {
            dotProduct += qWeight * cWeight;
          }
        }

        const cosineSim = Math.min(1.0, dotProduct / (queryNorm * chunkNorm));
        if (cosineSim > 0) {
          vectorScores.set(chunkId, cosineSim);
        }
      }
    }

    if (searchSymbols) {
      for (const token of queryTokens) {
        const lowerToken = token.toLowerCase();
        const symChunkIds = this.index.symbolIndex[lowerToken];
        if (symChunkIds) {
          for (const chunkId of symChunkIds) {
            symbolScores.set(chunkId, (symbolScores.get(chunkId) || 0) + 2.5);
            if (!matchSymbolsMap.has(chunkId)) {
              matchSymbolsMap.set(chunkId, new Set());
            }
            matchSymbolsMap.get(chunkId)!.add(lowerToken);
          }
        }
        for (const [symKey, ids] of Object.entries(this.index.symbolIndex)) {
          if (symKey === lowerToken) continue;
          if (symKey.includes(lowerToken)) {
            for (const chunkId of ids) {
              symbolScores.set(chunkId, (symbolScores.get(chunkId) || 0) + 1.2);
              if (!matchSymbolsMap.has(chunkId)) {
                matchSymbolsMap.set(chunkId, new Set());
              }
              matchSymbolsMap.get(chunkId)!.add(symKey);
            }
          }
        }
      }
    }

    if (searchFilePath && queryTokens.length > 0) {
      for (const chunk of this.index.chunks) {
        const lowerPath = chunk.file.toLowerCase();
        for (const token of queryTokens) {
          const lowerToken = token.toLowerCase();
          if (lowerPath.includes(lowerToken)) {
            pathScores.set(chunk.id, (pathScores.get(chunk.id) || 0) + 0.8);
          }
        }
      }
    }

    const allScoredChunkIds = new Set([
      ...bm25Scores.keys(),
      ...vectorScores.keys(),
      ...symbolScores.keys(),
      ...pathScores.keys(),
    ]);

    if (allScoredChunkIds.size === 0 && effectiveQuery.trim()) {
      const lowerQuery = effectiveQuery.toLowerCase();
      const queryWords = lowerQuery.split(/\s+/).filter((w) => w.length >= 1);

      for (const chunk of this.index.chunks) {
        const lowerContent = chunk.content.toLowerCase();
        let matchCount = 0;
        for (const w of queryWords) {
          if (lowerContent.includes(w)) matchCount++;
        }
        if (matchCount > 0) {
          bm25Scores.set(chunk.id, matchCount * 0.5);
          allScoredChunkIds.add(chunk.id);
        }
      }
    }

    const maxBm25 = Math.max(...Array.from(bm25Scores.values()), 0.001);

    const results: SearchResult[] = [];

    for (const chunkId of allScoredChunkIds) {
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

      const normBm25 = (bm25Scores.get(chunkId) || 0) / maxBm25;
      const cosSim = vectorScores.get(chunkId) || 0;
      const symBonus = Math.min(1.0, (symbolScores.get(chunkId) || 0) * 0.2);
      const pathBonus = Math.min(0.5, (pathScores.get(chunkId) || 0) * 0.2);

      let finalScore =
        (1 - semanticWeight) * normBm25 +
        semanticWeight * cosSim +
        symBonus +
        pathBonus;

      finalScore = Math.min(1.0, Math.max(0.0, finalScore));

      if (finalScore < minScore) continue;

      results.push({
        chunk,
        score: Number(finalScore.toFixed(4)),
        matchedKeywords: Array.from(matchKeywordsMap.get(chunkId) || []),
        matchedSymbols: Array.from(matchSymbolsMap.get(chunkId) || []),
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
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
        const snakeParts = lower.split(/[_-]+/);
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
