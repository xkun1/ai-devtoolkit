/**
 * 改动影响面追溯分析器
 */
import type { DependencyGraph, ImpactAnalysisResult } from './types.js';

export function analyzeImpact(
  graph: DependencyGraph,
  targetFile: string,
  symbol?: string,
): ImpactAnalysisResult {
  const normTarget = targetFile.replaceAll('\\', '/').replace(/^\.\//, '');

  const matchedKey =
    Object.keys(graph.nodes).find(
      (k) =>
        k === normTarget ||
        k.endsWith('/' + normTarget) ||
        k.includes(normTarget),
    ) || normTarget;

  const directDependents = graph.dependents[matchedKey] || [];
  const indirectDependents: { path: string; depth: number }[] = [];
  const affectedChains: string[][] = [];

  const visited = new Set<string>([matchedKey]);
  const queue: { path: string; depth: number; chain: string[] }[] = [];

  for (const dep of directDependents) {
    queue.push({ path: dep, depth: 1, chain: [matchedKey, dep] });
    visited.add(dep);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    indirectDependents.push({ path: current.path, depth: current.depth });
    affectedChains.push(current.chain);

    const nextUpstreams = graph.dependents[current.path] || [];
    for (const upstream of nextUpstreams) {
      if (!visited.has(upstream)) {
        visited.add(upstream);
        queue.push({
          path: upstream,
          depth: current.depth + 1,
          chain: [...current.chain, upstream],
        });
      }
    }
  }

  const totalAffected = visited.size - 1;
  const riskLevel = calculateRisk(totalAffected, graph.stats.totalFiles);

  return {
    targetFile: matchedKey,
    symbol,
    directDependents,
    indirectDependents,
    totalAffected,
    riskLevel,
    affectedChains: affectedChains.slice(0, 10),
  };
}

function calculateRisk(
  affected: number,
  total: number,
): 'Low' | 'Medium' | 'High' | 'Critical' {
  if (affected === 0) return 'Low';
  const ratio = total > 0 ? affected / total : 0;
  if (ratio > 0.4 || affected >= 15) return 'Critical';
  if (ratio > 0.2 || affected >= 8) return 'High';
  if (affected >= 3) return 'Medium';
  return 'Low';
}

export function formatImpactReport(result: ImpactAnalysisResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(
    `🎯 影响面分析报告: ${result.targetFile}${result.symbol ? ` (符号: ${result.symbol})` : ''}`,
  );
  lines.push('─'.repeat(60));
  lines.push(
    `⚠️  风险等级: [${result.riskLevel}] | 受影响文件数: ${result.totalAffected} 个`,
  );
  lines.push('');

  if (result.directDependents.length > 0) {
    lines.push(`📌 直接上游依赖方 (${result.directDependents.length} 个):`);
    for (const dep of result.directDependents) {
      lines.push(`  - ${dep}`);
    }
    lines.push('');
  }

  if (result.indirectDependents.length > result.directDependents.length) {
    lines.push(`⛓️ 递归传递受影响链路 (深度遍历):`);
    for (const item of result.indirectDependents) {
      if (item.depth > 1) {
        lines.push(`  - [Depth ${item.depth}] ${item.path}`);
      }
    }
    lines.push('');
  }

  if (result.totalAffected === 0) {
    lines.push('✨ 该文件为顶层入口或孤立模块，修改不会波及其他内部文件。');
    lines.push('');
  }

  return lines.join('\n');
}
