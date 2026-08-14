/**
 * 代码依赖图谱与影响面分析统一入口
 */
import type { ScanCodeOptions } from '../search/types.js';
import type {
  DependencyGraph,
  GraphEdge,
  GraphNode,
  ImpactAnalysisResult,
} from './types.js';
import { buildDependencyGraph } from './analyzer.js';
import { analyzeImpact, formatImpactReport } from './impact.js';
import { generateMermaidGraph } from './mermaid.js';
import { info, startSpinner, succeedSpinner } from '../utils/logger.js';

export {
  buildDependencyGraph,
  analyzeImpact,
  formatImpactReport,
  generateMermaidGraph,
};

export type { DependencyGraph, GraphNode, GraphEdge, ImpactAnalysisResult };

export async function printProjectGraph(
  options: ScanCodeOptions & { direction?: 'TD' | 'LR' } = {},
): Promise<string> {
  startSpinner('🔍 正在静态分析项目代码依赖关系...');
  const graph = await buildDependencyGraph(options);
  succeedSpinner(
    `依赖图构建完成: ${graph.stats.totalFiles} 文件 / ${graph.stats.totalEdges} 条依赖边`,
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
  options: ScanCodeOptions = {},
): Promise<ImpactAnalysisResult> {
  startSpinner('🔍 正在构建依赖拓扑并推演影响面...');
  const graph = await buildDependencyGraph(options);
  const result = analyzeImpact(graph, targetFile);
  succeedSpinner('影响面分析完成');

  console.log(formatImpactReport(result));
  return result;
}
