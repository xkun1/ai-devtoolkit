/** 轻量代码搜索子入口：不加载 LLM 解释器、Web 服务或主 CLI。 */
export {
  buildIndex,
  updateIndex,
  saveIndex,
  loadIndex,
  hasIndex,
  INDEX_FILENAME,
  INDEX_VERSION,
} from './indexer.js';
export { searchCode, CodeSearcher } from './searcher.js';
export {
  scanCodeFiles,
  detectLanguage,
  isCodeFile,
  extractSymbols,
  parseIgnoreFile,
  readCodeFile,
} from './scanner.js';
export type {
  CodeFile,
  CodeChunk,
  CodeSymbol,
  SearchResult,
  SearchIndex,
  SearchOptions,
  ScanCodeOptions,
  LanguageId,
  IndexMeta,
} from './types.js';
