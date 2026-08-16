/**
 * 代码依赖图谱与影响面分析统一入口
 */
import type {
  DependencyGraph,
  GraphEdge,
  GraphNode,
  DependencyGraphStats,
  ImpactAnalysisResult,
} from './types.js';
import { buildDependencyGraph, type GraphOptions } from './analyzer.js';
import { analyzeImpact, formatImpactReport } from './impact.js';
import { generateMermaidGraph } from './mermaid.js';
import {
  loadGraphCache,
  saveGraphCache,
  clearGraphCache,
  GRAPH_CACHE_FILENAME,
  GRAPH_CACHE_VERSION,
  type DependencyGraphCache,
  type FileNodeCache,
} from './cache.js';
import { info, startSpinner, succeedSpinner } from '../utils/logger.js';

export {
  buildDependencyGraph,
  analyzeImpact,
  formatImpactReport,
  generateMermaidGraph,
  loadGraphCache,
  saveGraphCache,
  clearGraphCache,
  GRAPH_CACHE_FILENAME,
  GRAPH_CACHE_VERSION,
};

export type {
  DependencyGraph,
  GraphNode,
  GraphEdge,
  DependencyGraphStats,
  ImpactAnalysisResult,
  GraphOptions,
  DependencyGraphCache,
  FileNodeCache,
};

export async function printProjectGraph(
  options: GraphOptions & { direction?: 'TD' | 'LR' } = {},
): Promise<string> {
  startSpinner('🔍 正在静态分析项目代码依赖关系...');
  const graph = await buildDependencyGraph(options);
  const cacheInfo =
    graph.stats.cacheHits !== undefined
      ? ` (增量命中 ${graph.stats.cacheHits} 文件 / 重解析 ${graph.stats.cacheMisses} 文件)`
      : '';
  succeedSpinner(
    `依赖图构建完成: ${graph.stats.totalFiles} 文件 / ${graph.stats.totalEdges} 条依赖边${cacheInfo}`,
  );

  const mermaid = generateMermaidGraph(graph, { direction: options.direction });
  info('');
  info('📊 项目架构依赖图 (Mermaid):');
  info('```mermaid');
  console.log(mermaid);
  info('```');
  info('');
  return mermaid;
}

export async function printImpactAnalysis(
  targetFile: string,
  options: GraphOptions = {},
): Promise<ImpactAnalysisResult> {
  startSpinner('🔍 正在构建依赖拓扑并推演影响面...');
  const graph = await buildDependencyGraph(options);
  const result = analyzeImpact(graph, targetFile);
  succeedSpinner('影响面分析完成');

  console.log(formatImpactReport(result));
  return result;
}
