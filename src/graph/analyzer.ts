/**
 * 依赖关系静态分析器
 *
 * 扫描项目代码，解析 import/export 语句，构建项目有向依赖图。
 */
import { readFile } from 'node:fs/promises';
import { join, dirname, normalize } from 'node:path';
import type { DependencyGraph, GraphEdge, GraphNode } from './types.js';
import type { ScanCodeOptions } from '../search/types.js';
import { scanCodeFiles, extractSymbols } from '../search/scanner.js';

export async function buildDependencyGraph(
  options: ScanCodeOptions = {},
): Promise<DependencyGraph> {
  const root = options.root || process.cwd();
  const files = await scanCodeFiles(options);

  const fileSet = new Set(files.map((f) => f.path.replaceAll('\\', '/')));
  const nodes: Record<string, GraphNode> = {};
  const dependencies: Record<string, string[]> = {};
  const dependents: Record<string, string[]> = {};
  const edges: GraphEdge[] = [];

  for (const f of files) {
    const normPath = f.path.replaceAll('\\', '/');
    nodes[normPath] = {
      id: normPath,
      path: normPath,
      language: f.language,
      exports: [],
      lines: f.lines,
    };
    dependencies[normPath] = [];
    dependents[normPath] = [];
  }

  for (const f of files) {
    const normPath = f.path.replaceAll('\\', '/');
    let content: string;
    try {
      content = await readFile(join(root, f.path), 'utf-8');
    } catch {
      continue;
    }

    const symbols = extractSymbols(content, f.language, normPath);
    nodes[normPath].exports = symbols.map((s) => s.name);

    const imports = extractImports(content, f.language);

    for (const imp of imports) {
      const resolvedTarget = resolveImportPath(normPath, imp.rawPath, fileSet);
      if (resolvedTarget && resolvedTarget !== normPath) {
        if (!dependencies[normPath].includes(resolvedTarget)) {
          dependencies[normPath].push(resolvedTarget);
        }
        if (!dependents[resolvedTarget].includes(normPath)) {
          dependents[resolvedTarget].push(normPath);
        }
        edges.push({
          source: normPath,
          target: resolvedTarget,
          specifiers: imp.specifiers,
          rawStatement: imp.statement,
        });
      }
    }
  }

  const isolatedFiles = Object.keys(nodes).filter(
    (k) => dependencies[k].length === 0 && dependents[k].length === 0,
  ).length;

  return {
    projectRoot: root,
    createdAt: Date.now(),
    nodes,
    dependencies,
    dependents,
    edges,
    stats: {
      totalFiles: files.length,
      totalEdges: edges.length,
      isolatedFiles,
    },
  };
}

interface RawImport {
  rawPath: string;
  specifiers: string[];
  statement: string;
}

export function extractImports(content: string, language: string): RawImport[] {
  const list: RawImport[] = [];

  if (
    language === 'typescript' ||
    language === 'javascript' ||
    language === 'vue' ||
    language === 'svelte'
  ) {
    const esImport =
      /import\s+(?:(?:(?:\{[^}]*\}|\*\s+as\s+[^,]+|[a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[^,]+))?)\s+from\s+)?['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = esImport.exec(content)) !== null) {
      list.push({
        rawPath: match[1],
        specifiers: extractSpecifiers(match[0]),
        statement: match[0],
      });
    }

    const cjsRequire =
      /(?:const|let|var)\s+(?:\{[^}]*\}|[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*require\(['"]([^'"]+)['"]\)/g;
    while ((match = cjsRequire.exec(content)) !== null) {
      list.push({
        rawPath: match[1],
        specifiers: extractSpecifiers(match[0]),
        statement: match[0],
      });
    }

    const exportFrom = /export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/g;
    while ((match = exportFrom.exec(content)) !== null) {
      list.push({
        rawPath: match[1],
        specifiers: extractSpecifiers(match[0]),
        statement: match[0],
      });
    }
  } else if (language === 'python') {
    const pyImport = /(?:from\s+(\S+)\s+import\s+([^\n]+)|import\s+([^\n]+))/g;
    let match: RegExpExecArray | null;
    while ((match = pyImport.exec(content)) !== null) {
      const fromPath = match[1];
      const importName = match[3];
      if (fromPath && (fromPath.startsWith('.') || !fromPath.includes('.'))) {
        list.push({
          rawPath: fromPath.replace(/^\.+/, (dots) =>
            dots.replaceAll('.', '/'),
          ),
          specifiers: match[2] ? match[2].split(',').map((s) => s.trim()) : [],
          statement: match[0],
        });
      } else if (importName && !importName.includes(',')) {
        list.push({
          rawPath: importName.trim(),
          specifiers: [],
          statement: match[0],
        });
      }
    }
  }

  return list;
}

function extractSpecifiers(statement: string): string[] {
  const curly = statement.match(/\{([^}]+)\}/);
  if (curly) {
    return curly[1]
      .split(',')
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter(Boolean);
  }
  if (statement.includes('*')) return ['*'];
  return [];
}

function resolveImportPath(
  currentFile: string,
  importPath: string,
  fileSet: Set<string>,
): string | null {
  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    const directCandidate = importPath + '.ts';
    if (fileSet.has(directCandidate)) return directCandidate;
    return null;
  }

  const currentDir = dirname(currentFile);
  const rawTarget = normalize(join(currentDir, importPath)).replaceAll(
    '\\',
    '/',
  );

  if (fileSet.has(rawTarget)) return rawTarget;

  const candidateExts = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py'];

  const strippedExt = rawTarget.replace(/\.(?:js|mjs|cjs)$/, '');
  for (const ext of candidateExts) {
    const candidate = strippedExt + ext;
    if (fileSet.has(candidate)) return candidate;
  }

  for (const ext of candidateExts) {
    const candidate = rawTarget + ext;
    if (fileSet.has(candidate)) return candidate;
  }

  for (const ext of candidateExts) {
    const candidate = rawTarget + '/index' + ext;
    if (fileSet.has(candidate)) return candidate;
  }

  return null;
}
