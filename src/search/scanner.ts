/**
 * 代码文件扫描器
 *
 * 递归扫描项目目录，识别编程语言，提取代码符号。
 * 支持自动读取 .gitignore 与 .devtoolkitignore 排除无用文件。
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
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

/** 解析 .gitignore 文件规则并生成 RegExp 列表 */
export function parseIgnoreFile(content: string): {
  dirs: Set<string>;
  patterns: RegExp[];
} {
  const dirs = new Set<string>();
  const patterns: RegExp[] = [];

  const lines = content.split('\n');
  for (let line of lines) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;

    // 目录规则（以 / 结尾）
    if (line.endsWith('/')) {
      const dirName = line.slice(0, -1).replace(/^\//, '');
      if (dirName && !dirName.includes('*')) {
        dirs.add(dirName);
        continue;
      }
    }

    // 单个简单目录
    if (!line.includes('/') && !line.includes('.')) {
      dirs.add(line);
      continue;
    }

    // Glob 转 RegExp
    const cleanPattern = line.replace(/^\//, '');
    const regexStr = cleanPattern
      .replace(/\./g, '\\.')
      .replace(/\*\*/g, '.*')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.');
    try {
      patterns.push(new RegExp(`(^|/)${regexStr}($|/)`));
    } catch {
      // 忽略非法正则
    }
  }

  return { dirs, patterns };
}

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

  // 自动读取 .gitignore 和 .devtoolkitignore
  for (const ignoreFileName of ['.gitignore', '.devtoolkitignore']) {
    const ignoreFilePath = join(root, ignoreFileName);
    if (existsSync(ignoreFilePath)) {
      try {
        const content = readFileSync(ignoreFilePath, 'utf-8');
        const parsed = parseIgnoreFile(content);
        for (const d of parsed.dirs) ignoreDirs.add(d);
        ignorePatterns.push(...parsed.patterns);
      } catch {
        // ignore
      }
    }
  }

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

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name);
      const relPath = relative(root, fullPath);

      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name) || entry.name.startsWith('.')) continue;
        if (ignorePatterns.some((p) => p.test(relPath) || p.test(entry.name)))
          continue;
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && isCodeFile(entry.name)) {
        if (ignorePatterns.some((p) => p.test(relPath) || p.test(entry.name)))
          continue;

        let fileStat;
        try {
          fileStat = await stat(fullPath);
        } catch {
          continue;
        }

        if (fileStat.size > maxFileSize || fileStat.size === 0) continue;

        let lineCount: number;
        try {
          const content = await readFile(fullPath, 'utf-8');
          lineCount = content.split('\n').length;
        } catch {
          continue;
        }

        results.push({
          path: relPath,
          language: detectLanguage(entry.name),
          size: fileStat.size,
          lines: lineCount,
          lastModified: fileStat.mtimeMs,
        });
      }
    }
  }

  await walk(root, 0);
  return results;
}

// ── 代码符号提取器 ──

interface SymbolPattern {
  kind: CodeSymbol['kind'];
  pattern: RegExp;
}

const SYMBOL_PATTERNS: Partial<Record<LanguageId, SymbolPattern[]>> = {
  typescript: [
    {
      kind: 'class',
      pattern: /(?:export\s+)?(?:abstract\s+)?class\s+([A-Z][a-zA-Z0-9_$]*)/g,
    },
    {
      kind: 'interface',
      pattern: /(?:export\s+)?interface\s+([A-Z][a-zA-Z0-9_$]*)/g,
    },
    {
      kind: 'type',
      pattern: /(?:export\s+)?type\s+([A-Z][a-zA-Z0-9_$]*)\s*=/g,
    },
    {
      kind: 'enum',
      pattern: /(?:export\s+)?(?:const\s+)?enum\s+([A-Z][a-zA-Z0-9_$]*)/g,
    },
    {
      kind: 'function',
      pattern:
        /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    },
    {
      kind: 'function',
      pattern:
        /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    },
    { kind: 'variable', pattern: /(?:export\s+)?const\s+([A-Z_0-9]{2,})\s*=/g },
  ],
  javascript: [
    { kind: 'class', pattern: /(?:export\s+)?class\s+([A-Z][a-zA-Z0-9_$]*)/g },
    {
      kind: 'function',
      pattern:
        /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g,
    },
    {
      kind: 'function',
      pattern:
        /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    },
    { kind: 'variable', pattern: /(?:export\s+)?const\s+([A-Z_0-9]{2,})\s*=/g },
  ],
  python: [
    { kind: 'class', pattern: /^class\s+([A-Z][a-zA-Z0-9_]*)/gm },
    { kind: 'function', pattern: /^def\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm },
    { kind: 'function', pattern: /^\s+def\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm },
  ],
  java: [
    {
      kind: 'class',
      pattern:
        /(?:public|protected|private)?\s*(?:static)?\s*(?:final)?\s*(?:abstract)?\s*class\s+([A-Z][a-zA-Z0-9_]*)/g,
    },
    {
      kind: 'interface',
      pattern:
        /(?:public|protected|private)?\s*interface\s+([A-Z][a-zA-Z0-9_]*)/g,
    },
    {
      kind: 'enum',
      pattern: /(?:public|protected|private)?\s*enum\s+([A-Z][a-zA-Z0-9_]*)/g,
    },
    {
      kind: 'function',
      pattern:
        /(?:public|protected|private|static|final|native|synchronized|\s)+[\w<>[\]]+\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g,
    },
  ],
  go: [
    { kind: 'type', pattern: /^type\s+([A-Z][a-zA-Z0-9_]*)\s+struct/gm },
    {
      kind: 'interface',
      pattern: /^type\s+([A-Z][a-zA-Z0-9_]*)\s+interface/gm,
    },
    { kind: 'function', pattern: /^func\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm },
    {
      kind: 'function',
      pattern: /^func\s+\([^)]+\)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm,
    },
  ],
  rust: [
    { kind: 'type', pattern: /(?:pub\s+)?struct\s+([A-Z][a-zA-Z0-9_]*)/g },
    { kind: 'type', pattern: /(?:pub\s+)?enum\s+([A-Z][a-zA-Z0-9_]*)/g },
    { kind: 'interface', pattern: /(?:pub\s+)?trait\s+([A-Z][a-zA-Z0-9_]*)/g },
    {
      kind: 'function',
      pattern: /(?:pub\s+)?(?:async\s+)?fn\s+([a-z_][a-zA-Z0-9_]*)/g,
    },
  ],
};

const KEYWORDS = new Set([
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
]);

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
      if (KEYWORDS.has(name)) continue;

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

/** 读取单个代码文件内容 */
export async function readCodeFile(
  root: string,
  filePath: string,
): Promise<string> {
  return readFile(join(root, filePath), 'utf-8');
}
