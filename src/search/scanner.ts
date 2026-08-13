/**
 * 代码文件扫描器
 *
 * 递归扫描项目目录，识别编程语言，提取代码符号。
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import type {
  CodeFile,
  CodeSymbol,
  LanguageId,
  ScanCodeOptions,
} from './types.js';

// ── 语言扩展名映射 ──

const EXTENSION_MAP: Record<string, LanguageId> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.java': 'java',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.cs': 'csharp',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.hpp': 'cpp',
  '.h': 'c',
  '.c': 'c',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.scala': 'scala',
  '.sc': 'scala',
  '.dart': 'dart',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.md': 'markdown',
  '.markdown': 'markdown',
};

/** 应忽略的目录名（非文档场景的代码项目专用） */
const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '__pycache__',
  '.gradle',
  '.idea',
  '.vscode',
  'target',
  '.target',
  'bin',
  'obj',
  '.venv',
  'venv',
  '.env',
  'coverage',
  '.nyc_output',
  '.turbo',
  '.parcel-cache',
  'out',
  '.angular',
]);

/** 应忽略的文件名模式 */
const DEFAULT_IGNORED_PATTERNS = [
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /^package-lock\.json$/,
  /^yarn\.lock$/,
  /^pnpm-lock\.yaml$/,
  /^Cargo\.lock$/,
  /^go\.sum$/,
  /\.pb\.go$/,
  /\.gen\.ts$/,
  /\.generated\./,
] as readonly RegExp[];

/** 根据扩展名获取语言 */
export function detectLanguage(filename: string): LanguageId {
  const ext = extname(filename).toLowerCase();
  return EXTENSION_MAP[ext] || 'unknown';
}

/** 判断文件是否是可索引的代码文件 */
export function isCodeFile(filename: string): boolean {
  return detectLanguage(filename) !== 'unknown';
}

/** 扫描项目目录，返回所有代码文件 */
export async function scanCodeFiles(
  options: ScanCodeOptions = {},
): Promise<CodeFile[]> {
  const root = options.root || process.cwd();
  const ignoreDirs = new Set([
    ...DEFAULT_IGNORED_DIRS,
    ...(options.ignoreDirs || []),
  ]);
  const ignorePatterns = [
    ...DEFAULT_IGNORED_PATTERNS,
    ...(options.ignorePatterns?.map((p) =>
      typeof p === 'string' ? new RegExp(p) : p,
    ) || []),
  ];
  const maxFileSize = options.maxFileSize ?? 512 * 1024; // 512KB
  const maxDepth = options.maxDepth ?? 20;

  const results: CodeFile[] = [];

  async function walk(currentPath: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;

    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }

    // 按名称排序保证顺序稳定
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && isCodeFile(entry.name)) {
        // 跳过锁文件、压缩文件等
        if (ignorePatterns.some((p) => p.test(entry.name))) continue;

        try {
          const fileStat = await stat(fullPath);
          if (fileStat.size > maxFileSize) continue;
          if (fileStat.size === 0) continue;

          const relPath = relative(root, fullPath);
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n').length;

          results.push({
            path: relPath,
            language: detectLanguage(entry.name),
            size: fileStat.size,
            lines,
          });
        } catch {
          // 读取失败跳过
        }
      }
    }
  }

  await walk(root, 0);
  return results;
}

// ── 符号提取 ──

/** 各语言的符号提取正则规则 */
const SYMBOL_PATTERNS: Record<
  string,
  { kind: CodeSymbol['kind']; pattern: RegExp }[]
> = {
  typescript: [
    // classdeclaration
    {
      kind: 'class',
      pattern:
        /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
    },
    // interface
    { kind: 'interface', pattern: /^\s*(?:export\s+)?interface\s+(\w+)/gm },
    // type alias
    { kind: 'type', pattern: /^\s*(?:export\s+)?type\s+(\w+)\s*=/gm },
    // enum
    { kind: 'enum', pattern: /^\s*(?:export\s+)?(?:const\s+)?enum\s+(\w+)/gm },
    // function declaration
    {
      kind: 'function',
      pattern:
        /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
    },
    // const arrow function
    {
      kind: 'const',
      pattern:
        /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>/gm,
    },
    // const (non-arrow)
    { kind: 'const', pattern: /^\s*(?:export\s+)?const\s+(\w+)\s*[:=]/gm },
  ],
  javascript: [
    {
      kind: 'class',
      pattern: /^\s*(?:export\s+)?(?:default\s+)?class\s+(\w+)/gm,
    },
    {
      kind: 'function',
      pattern:
        /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/gm,
    },
    {
      kind: 'const',
      pattern:
        /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>/gm,
    },
    {
      kind: 'const',
      pattern: /^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*[:=]/gm,
    },
  ],
  java: [
    {
      kind: 'class',
      pattern:
        /^\s*(?:public|private|protected)?\s*(?:abstract\s+)?(?:final\s+)?class\s+(\w+)/gm,
    },
    {
      kind: 'interface',
      pattern: /^\s*(?:public|private|protected)?\s*interface\s+(\w+)/gm,
    },
    {
      kind: 'enum',
      pattern: /^\s*(?:public|private|protected)?\s*enum\s+(\w+)/gm,
    },
    // 方法：修饰符 + 返回类型 + 方法名(
    {
      kind: 'method',
      pattern:
        /^\s*(?:public|private|protected|static|final|abstract|synchronized)\s+(?:[\w<>[\],?\s]+)\s+(\w+)\s*\(/gm,
    },
  ],
  kotlin: [
    {
      kind: 'class',
      pattern:
        /^\s*(?:internal\s+|private\s+|public\s+)?(?:data\s+|sealed\s+|abstract\s+|open\s+)?class\s+(\w+)/gm,
    },
    {
      kind: 'interface',
      pattern: /^\s*(?:internal\s+|private\s+|public\s+)?interface\s+(\w+)/gm,
    },
    {
      kind: 'function',
      pattern:
        /^\s*(?:internal\s+|private\s+|public\s+|inline\s+|suspend\s+)?fun\s+(\w+)/gm,
    },
    { kind: 'enum', pattern: /^\s*(?:internal\s+)?enum\s+class\s+(\w+)/gm },
    { kind: 'type', pattern: /^\s*(?:internal\s+)?typealias\s+(\w+)/gm },
  ],
  python: [
    { kind: 'class', pattern: /^\s*class\s+(\w+)/gm },
    { kind: 'function', pattern: /^\s*(?:async\s+)?def\s+(\w+)/gm },
  ],
  go: [
    { kind: 'function', pattern: /^func\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/gm },
    { kind: 'type', pattern: /^type\s+(\w+)\s+(?:struct|interface)/gm },
    { kind: 'const', pattern: /^const\s+(\w+)/gm },
    { kind: 'type', pattern: /^type\s+(\w+)\s/gm },
  ],
  rust: [
    { kind: 'function', pattern: /^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm },
    { kind: 'class', pattern: /^\s*(?:pub\s+)?struct\s+(\w+)/gm },
    { kind: 'interface', pattern: /^\s*(?:pub\s+)?trait\s+(\w+)/gm },
    { kind: 'enum', pattern: /^\s*(?:pub\s+)?enum\s+(\w+)/gm },
    { kind: 'const', pattern: /^\s*(?:pub\s+)?(?:const|static)\s+(\w+)/gm },
  ],
  csharp: [
    {
      kind: 'class',
      pattern:
        /^\s*(?:public|private|protected|internal)?\s*(?:abstract\s+|sealed\s+|static\s+)?class\s+(\w+)/gm,
    },
    {
      kind: 'interface',
      pattern:
        /^\s*(?:public|private|protected|internal)?\s*interface\s+(\w+)/gm,
    },
    {
      kind: 'enum',
      pattern: /^\s*(?:public|private|protected|internal)?\s*enum\s+(\w+)/gm,
    },
    {
      kind: 'method',
      pattern:
        /^\s*(?:public|private|protected|internal|static|virtual|override|async)\s+(?:[\w<>[\],?\s]+)\s+(\w+)\s*\(/gm,
    },
  ],
  cpp: [
    { kind: 'class', pattern: /^\s*(?:template\s*<[^>]*>\s*)?class\s+(\w+)/gm },
    {
      kind: 'function',
      pattern:
        /^\s*(?:[\w:*&<>[\]\s]+)\s+(\w+)\s*\([^)]*\)\s*(?:const)?\s*\{/gm,
    },
    { kind: 'type', pattern: /^\s*struct\s+(\w+)/gm },
    { kind: 'enum', pattern: /^\s*enum\s+(?:class\s+)?(\w+)/gm },
  ],
  c: [
    {
      kind: 'function',
      pattern:
        /^\s*(?:static\s+|inline\s+)?(?:[\w*<>\s]+)\s+(\w+)\s*\([^)]*\)\s*\{/gm,
    },
    { kind: 'type', pattern: /^\s*struct\s+(\w+)/gm },
    { kind: 'enum', pattern: /^\s*enum\s+(\w+)/gm },
  ],
  php: [
    { kind: 'class', pattern: /^\s*(?:abstract\s+|final\s+)?class\s+(\w+)/gm },
    { kind: 'interface', pattern: /^\s*interface\s+(\w+)/gm },
    {
      kind: 'function',
      pattern: /^\s*(?:public|private|protected|static)?\s*function\s+(\w+)/gm,
    },
  ],
  ruby: [
    { kind: 'class', pattern: /^\s*class\s+(\w+)/gm },
    { kind: 'function', pattern: /^\s*def\s+(\w+)/gm },
    { kind: 'const', pattern: /^\s*([A-Z]\w*)\s*=/gm },
  ],
  swift: [
    {
      kind: 'class',
      pattern:
        /^\s*(?:public|private|internal|fileprivate|open)?\s*(?:final\s+)?class\s+(\w+)/gm,
    },
    {
      kind: 'interface',
      pattern: /^\s*(?:public|private|internal)?\s*protocol\s+(\w+)/gm,
    },
    {
      kind: 'function',
      pattern:
        /^\s*(?:public|private|internal|fileprivate|static)?\s*func\s+(\w+)/gm,
    },
    {
      kind: 'enum',
      pattern: /^\s*(?:public|private|internal)?\s*enum\s+(\w+)/gm,
    },
    {
      kind: 'class',
      pattern: /^\s*(?:public|private|internal)?\s*struct\s+(\w+)/gm,
    },
  ],
  scala: [
    {
      kind: 'class',
      pattern: /^\s*(?:case\s+|abstract\s+|final\s+)?class\s+(\w+)/gm,
    },
    { kind: 'interface', pattern: /^\s*trait\s+(\w+)/gm },
    { kind: 'function', pattern: /^\s*(?:private|protected)?\s*def\s+(\w+)/gm },
    {
      kind: 'const',
      pattern: /^\s*(?:private|protected|lazy)?\s*(?:val|var)\s+(\w+)/gm,
    },
  ],
  dart: [
    { kind: 'class', pattern: /^\s*(?:abstract\s+)?class\s+(\w+)/gm },
    {
      kind: 'function',
      pattern:
        /^\s*(?:static\s+|async\s+|Future<[^>]*>\s+)?(?:void|[\w<>]+\s+)?(\w+)\s*\(/gm,
    },
    { kind: 'enum', pattern: /^\s*enum\s+(\w+)/gm },
  ],
};

/**
 * 从代码内容中提取符号
 */
export function extractSymbols(
  content: string,
  language: LanguageId,
  filePath: string,
): CodeSymbol[] {
  const patterns = SYMBOL_PATTERNS[language];
  if (!patterns) return [];

  const symbols: CodeSymbol[] = [];
  const seen = new Set<string>();

  for (const { kind, pattern } of patterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const name = match[1];
      if (!name || name.length < 2) continue;

      // 跳过关键字
      if (KEYWORDS.has(name)) continue;

      // 计算行号
      const line = content.slice(0, match.index).split('\n').length;
      const key = `${kind}:${name}:${line}`;
      if (seen.has(key)) continue;
      seen.add(key);

      symbols.push({
        name,
        kind,
        file: filePath,
        line,
      });
    }
  }

  return symbols;
}

/** 保留关键字集合（多语言汇总） */
const KEYWORDS = new Set([
  // TS/JS
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'return',
  'try',
  'catch',
  'finally',
  'throw',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'this',
  'super',
  'extends',
  'implements',
  'import',
  'export',
  'from',
  'as',
  'async',
  'await',
  'yield',
  'void',
  'null',
  'undefined',
  'true',
  'false',
  'let',
  'const',
  'var',
  'function',
  'class',
  'interface',
  'type',
  'enum',
  'namespace',
  'module',
  'declare',
  'readonly',
  'static',
  'public',
  'private',
  'protected',
  'abstract',
  'get',
  'set',
  // Java
  'synchronized',
  'volatile',
  'transient',
  'native',
  'strictfp',
  'package',
  'throws',
  'default',
  'final',
  // Python
  'def',
  'lambda',
  'pass',
  'with',
  'global',
  'nonlocal',
  'is',
  'not',
  'and',
  'or',
  'None',
  'True',
  'False',
  'except',
  'raise',
  'assert',
  'del',
  'elif',
  'yield',
  'print',
  // Go
  'func',
  'go',
  'chan',
  'select',
  'defer',
  'range',
  'map',
  'struct',
  'type',
  'package',
  'interface',
  'fallthrough',
  'goto',
  // Rust
  'fn',
  'let',
  'mut',
  'use',
  'crate',
  'extern',
  'impl',
  'trait',
  'where',
  'unsafe',
  'move',
  'ref',
  'match',
  'box',
  'dyn',
  'macro',
  // PHP
  'echo',
  'require',
  'include',
  'require_once',
  'include_once',
  'global',
  'static',
  'abstract',
  'final',
  // 通用
  'int',
  'string',
  'bool',
  'boolean',
  'float',
  'double',
  'char',
  'byte',
  'short',
  'long',
  'unsigned',
  'signed',
  'auto',
  'var',
  'object',
  'dynamic',
  'any',
  'never',
  'unknown',
  'symbol',
  'bigint',
  'number',
]);

/** 读取文件内容（用于索引构建） */
export async function readCodeFile(
  root: string,
  filePath: string,
): Promise<string> {
  try {
    return await readFile(join(root, filePath), 'utf-8');
  } catch {
    return '';
  }
}
