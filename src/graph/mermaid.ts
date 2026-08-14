/**
 * 架构依赖拓扑图生成器 (按模块 Subgraph 聚类优化)
 */
import type { DependencyGraph } from './types.js';

export function generateMermaidGraph(
  graph: DependencyGraph,
  options: { maxNodes?: number; direction?: 'TD' | 'LR' } = {},
): string {
  const maxNodes = options.maxNodes ?? 40;
  const direction = options.direction ?? 'TD';

  const lines: string[] = [];
  lines.push(`graph ${direction}`);

  // 按入度+出度排序筛选核心活跃节点
  const sortedNodes = Object.entries(graph.nodes)
    .sort(
      (a, b) =>
        (graph.dependents[b[0]]?.length || 0) +
        (graph.dependencies[b[0]]?.length || 0) -
        ((graph.dependents[a[0]]?.length || 0) +
          (graph.dependencies[a[0]]?.length || 0)),
    )
    .slice(0, maxNodes);

  const activeNodeSet = new Set(sortedNodes.map(([k]) => k));

  // 按模块目录进行 Subgraph 聚类
  const modules: Record<string, string[]> = {};
  for (const [key] of sortedNodes) {
    const parts = key.split('/');
    const moduleName = parts.length > 1 ? parts.slice(0, 2).join('/') : 'root';
    if (!modules[moduleName]) modules[moduleName] = [];
    modules[moduleName].push(key);
  }

  // 渲染 Subgraph 分组
  for (const [mod, nodeKeys] of Object.entries(modules)) {
    const safeModId = mod.replace(/[^a-zA-Z0-9_]/g, '_');
    lines.push(`  subgraph ${safeModId} ["📁 ${mod}"]`);
    for (const key of nodeKeys) {
      const safeId = key.replace(/[^a-zA-Z0-9_]/g, '_');
      const label = key.split('/').pop() || key;
      lines.push(`    ${safeId}["${label}"]`);
    }
    lines.push('  end');
  }

  lines.push('');

  // 渲染依赖连线
  let edgeCount = 0;
  for (const edge of graph.edges) {
    if (activeNodeSet.has(edge.source) && activeNodeSet.has(edge.target)) {
      const srcId = edge.source.replace(/[^a-zA-Z0-9_]/g, '_');
      const tgtId = edge.target.replace(/[^a-zA-Z0-9_]/g, '_');
      lines.push(`  ${srcId} --> ${tgtId}`);
      edgeCount++;
      if (edgeCount >= 70) break;
    }
  }

  return lines.join('\n');
}
