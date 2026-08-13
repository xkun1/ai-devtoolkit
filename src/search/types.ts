/**
 * 代码搜索功能类型定义
 */

/** 支持的编程语言标识 */
export type LanguageId =
  | 'typescript'
  | 'javascript'
  | 'java'
  | 'kotlin'
  | 'python'
  | 'go'
  | 'rust'
  | 'csharp'
  | 'cpp'
  | 'c'
  | 'php'
  | 'ruby'
  | 'swift'
  | 'scala'
  | 'dart'
  | 'vue'
  | 'svelte'
  | 'html'
  | 'css'
  | 'scss'
  | 'json'
  | 'yaml'
  | 'xml'
  | 'sql'
  | 'shell'
  | 'markdown'
  | 'unknown';

/** 扫描到的代码文件元信息 */
export interface CodeFile {
  /** 相对于项目根目录的路径 */
  path: string;
  /** 语言标识 */
  language: LanguageId;
  /** 文件大小（字节） */
  size: number;
  /** 行数 */
  lines: number;
}

/** 从代码中提取的符号 */
export interface CodeSymbol {
  /** 符号名称 */
  name: string;
  /** 符号类型 */
  kind:
    | 'class'
    | 'function'
    | 'method'
    | 'variable'
    | 'interface'
    | 'type'
    | 'enum'
    | 'const';
  /** 所在文件路径 */
  file: string;
  /** 起始行号（1-based） */
  line: number;
  /** 结束行号（1-based，近似值） */
  endLine?: number;
}

/** 代码分块（用于索引） */
export interface CodeChunk {
  /** 唯一 ID */
  id: string;
  /** 文件路径 */
  file: string;
  /** 语言 */
  language: LanguageId;
  /** 起始行号（1-based） */
  startLine: number;
  /** 结束行号（1-based） */
  endLine: number;
  /** 原始代码内容 */
  content: string;
  /** 提取的关键词（分词后去重） */
  keywords: string[];
  /** 提取的符号名 */
  symbols: string[];
}

/** 单条搜索结果 */
export interface SearchResult {
  /** 匹配的分块 */
  chunk: CodeChunk;
  /** 相关性得分（0-1） */
  score: number;
  /** 匹配的关键词 */
  matchedKeywords: string[];
  /** 匹配的符号名 */
  matchedSymbols: string[];
}

/** 搜索索引 */
export interface SearchIndex {
  /** 索引版本 */
  version: string;
  /** 项目根目录 */
  projectRoot: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 所有扫描到的文件 */
  files: CodeFile[];
  /** 所有代码分块 */
  chunks: CodeChunk[];
  /** 所有提取的符号 */
  symbols: CodeSymbol[];
  /** 关键词 → 分块 ID 的倒排索引 */
  invertedIndex: Record<string, string[]>;
  /** 符号名 → 分块 ID 的倒排索引 */
  symbolIndex: Record<string, string[]>;
  /** 统计信息 */
  stats: {
    totalFiles: number;
    totalLines: number;
    totalChunks: number;
    totalSymbols: number;
    totalKeywords: number;
    languages: Record<string, number>;
  };
}

/** 扫描选项 */
export interface ScanCodeOptions {
  /** 项目根目录（默认 cwd） */
  root?: string;
  /** 自定义忽略的目录 */
  ignoreDirs?: string[];
  /** 自定义忽略的文件 glob 模式 */
  ignorePatterns?: string[];
  /** 最大文件大小（字节，超过则跳过，默认 512KB） */
  maxFileSize?: number;
  /** 每个分块的目标行数（默认 80 行） */
  chunkLines?: number;
  /** 分块重叠行数（默认 10 行） */
  chunkOverlap?: number;
  /** 是否提取符号（默认 true） */
  extractSymbols?: boolean;
  /** 最大递归深度（默认 20） */
  maxDepth?: number;
}

/** 搜索选项 */
export interface SearchOptions {
  /** 返回结果数量上限（默认 10） */
  limit?: number;
  /** 最低匹配分数阈值（0-1，默认 0） */
  minScore?: number;
  /** 是否搜索符号名（默认 true） */
  searchSymbols?: boolean;
  /** 是否搜索文件路径（默认 true） */
  searchFilePath?: boolean;
}

/** 解释结果的选项 */
export interface ExplainOptions {
  /** LLM 配置 */
  llm: import('../types/index.js').LLMConfig;
  /** 用户查询 */
  query: string;
  /** 搜索结果列表 */
  results: SearchResult[];
  /** 项目根目录 */
  projectRoot: string;
}

/** 索引文件元数据 */
export interface IndexMeta {
  version: string;
  projectRoot: string;
  createdAt: number;
  fileCount: number;
  chunkCount: number;
}
