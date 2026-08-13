/**
 * 代码搜索 — 编排入口
 *
 * 提供初始化扫描、搜索、交互模式的高层 API。
 */
import type {
  ScanCodeOptions,
  SearchOptions,
  SearchResult,
  SearchIndex,
} from './types.js';
import { buildIndex, saveIndex, loadIndex } from './indexer.js';
import { searchCode } from './searcher.js';
import { explainResults, formatResultsPlain } from './explainer.js';
import { startInteractiveSearch } from './interactive.js';
import type { LLMConfig } from '../types/index.js';
import {
  info,
  success,
  warn,
  startSpinner,
  succeedSpinner,
  failSpinner,
} from '../utils/logger.js';

export {
  buildIndex,
  saveIndex,
  loadIndex,
  hasIndex,
  INDEX_FILENAME,
} from './indexer.js';
export { searchCode, CodeSearcher } from './searcher.js';
export { explainResults, formatResultsPlain } from './explainer.js';
export { startInteractiveSearch } from './interactive.js';
export {
  scanCodeFiles,
  detectLanguage,
  isCodeFile,
  extractSymbols,
  readCodeFile,
} from './scanner.js';

// 重导出类型
export type {
  CodeFile,
  CodeChunk,
  CodeSymbol,
  SearchResult,
  SearchIndex,
  SearchOptions,
  ScanCodeOptions,
  LanguageId,
  ExplainOptions,
  IndexMeta,
} from './types.js';

/**
 * 初始化扫描：扫描项目代码并构建索引
 *
 * @param options 扫描选项
 * @returns 构建的索引
 */
export async function initCodeIndex(
  options: ScanCodeOptions = {},
): Promise<SearchIndex> {
  const root = options.root || process.cwd();

  startSpinner('正在扫描项目代码文件...');
  let index: SearchIndex;
  try {
    index = await buildIndex(options);
  } catch (err: any) {
    failSpinner(`扫描失败: ${err.message}`);
    throw err;
  }

  succeedSpinner(
    `扫描完成: ${index.stats.totalFiles} 文件 / ${index.stats.totalLines} 行 / ${index.stats.totalChunks} 分块`,
  );

  // 保存索引
  const indexPath = await saveIndex(index, root);
  success(`索引已保存: ${indexPath}`);

  // 打印统计
  info('');
  info('  📊 项目统计:');
  info(`     文件数: ${index.stats.totalFiles}`);
  info(`     代码行: ${index.stats.totalLines.toLocaleString()}`);
  info(`     分块数: ${index.stats.totalChunks}`);
  info(`     符号数: ${index.stats.totalSymbols}`);
  info(`     关键词: ${index.stats.totalKeywords}`);

  const langList = Object.entries(index.stats.languages)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  if (langList.length > 0) {
    info('     语言分布:');
    for (const [lang, count] of langList) {
      info(`       ${lang}: ${count} 文件`);
    }
  }
  info('');

  return index;
}

/**
 * 搜索代码（自动加载索引）
 *
 * @param query 搜索查询
 * @param options 搜索选项
 * @param root 项目根目录
 * @returns 搜索结果列表
 */
export async function searchProjectCode(
  query: string,
  options: SearchOptions = {},
  root: string = process.cwd(),
): Promise<{ results: SearchResult[]; index: SearchIndex }> {
  // 尝试加载已有索引
  let index = await loadIndex(root);

  if (!index) {
    warn('未找到索引，正在自动扫描...');
    index = await initCodeIndex({ root });
  }

  const results = searchCode(index, query, options);
  return { results, index };
}

/**
 * 搜索并输出结果（单次搜索模式）
 *
 * @param query 搜索查询
 * @param llm LLM 配置（可选，用于智能解释）
 * @param useExplain 是否使用 LLM 解释
 * @param root 项目根目录
 * @param options 搜索选项
 */
export async function searchAndPrint(
  query: string,
  llm: LLMConfig | undefined,
  useExplain: boolean,
  root?: string,
  options?: SearchOptions,
): Promise<void> {
  const { results, index } = await searchProjectCode(query, options, root);

  if (useExplain && llm && results.length > 0) {
    startSpinner('🤖 正在用 LLM 分析结果...');
    try {
      const explanation = await explainResults({
        llm,
        query,
        results,
        projectRoot: index.projectRoot,
      });
      succeedSpinner('分析完成');
      console.log('\n' + explanation);
    } catch (err: any) {
      failSpinner(`LLM 分析失败: ${err.message}`);
      console.log(formatResultsPlain(results, index.projectRoot));
    }
  } else {
    console.log(formatResultsPlain(results, index.projectRoot));
  }
}

/**
 * 启动交互式搜索（初始化索引后进入 REPL）
 *
 * @param llm LLM 配置（可选）
 * @param useExplain 是否使用 LLM 解释
 * @param root 项目根目录
 */
export async function startSearchSession(
  llm: LLMConfig | undefined,
  useExplain: boolean,
  root?: string,
): Promise<void> {
  // 加载或创建索引
  let index = await loadIndex(root || process.cwd());

  if (!index) {
    info('未找到索引，正在初始化扫描...');
    index = await initCodeIndex({ root });
  } else {
    success(
      `已加载索引 (${index.stats.totalFiles} 文件 / ${index.stats.totalChunks} 分块)`,
    );
  }

  startInteractiveSearch({
    index,
    llm,
    useExplain,
  });
}
