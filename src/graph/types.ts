/**
 * 代码依赖图谱与影响面分析类型定义
 */
import type { LanguageId } from '../search/types.js';

/** 依赖图中的节点（对应一个源代码文件） */
export interface GraphNode {
  id: string;
  path: string;
  language: LanguageId;
  /** 该文件导出的符号列表 */
  exports: string[];
  /** 包含的代码行数 */
  lines: number;
}

/** 依赖关系边（A 依赖/导入 B） */
export interface GraphEdge {
  /** 导入方文件路径 (from) */
  source: string;
  /** 被导入方文件路径 (to) */
  target: string;
  /** 导入的具体符号，若为全量导入则为空或 ['*'] */
  specifiers?: string[];
  /** 原始 import/require 语句 */
  rawStatement?: string;
}

/** 依赖图统计信息 */
export interface DependencyGraphStats {
  totalFiles: number;
  totalEdges: number;
  isolatedFiles: number;
  /** 增量分析命中缓存的文件数 */
  cacheHits?: number;
  /** 未命中缓存需要重新静态解析的文件数 */
  cacheMisses?: number;
}

/** 完整项目依赖图谱 */
export interface DependencyGraph {
  projectRoot: string;
  createdAt: number;
  nodes: Record<string, GraphNode>;
  /** 出边邻接表：filePath -> 该文件所依赖的目标文件列表 */
  dependencies: Record<string, string[]>;
  /** 入边反向邻接表：filePath -> 依赖该文件的上游调用方列表 */
  dependents: Record<string, string[]>;
  edges: GraphEdge[];
  stats: DependencyGraphStats;
}

/** 影响面分析结果 */
export interface ImpactAnalysisResult {
  targetFile: string;
  symbol?: string;
  /** 直接受影响的上游文件列表 */
  directDependents: string[];
  /** 间接受影响的所有上游调用链路 (含深度) */
  indirectDependents: { path: string; depth: number }[];
  /** 完整的受影响上游文件总数 */
  totalAffected: number;
  /** 影响度级别：Low / Medium / High / Critical */
  riskLevel: 'Low' | 'Medium' | 'High' | 'Critical';
  /** 拓扑链路路径示例 (用于排查) */
  affectedChains: string[][];
}
