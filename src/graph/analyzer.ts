/**
 * 依赖关系静态分析器
 *
 * 扫描项目代码，解析 import/export/use/mod 语句，构建项目有向依赖图。
 * 支持 TypeScript, JavaScript, Python, Go, Rust, Java 等主流语言。
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
      const resolvedTarget = resolveImportPath(
        normPath,
        imp.rawPath,
        fileSet,
        f.language,
      );
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

export interface RawImport {
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
  } else if (language === 'go') {
    const singleGoImport = /import\s+(?:[a-zA-Z0-9_.]+\s+)?["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = singleGoImport.exec(content)) !== null) {
      list.push({
        rawPath: match[1],
        specifiers: [],
        statement: match[0],
      });
    }

    const blockGoImport = /import\s*\(([\s\S]*?)\)/g;
    while ((match = blockGoImport.exec(content)) !== null) {
      const blockContent = match[1];
      const itemRegex = /(?:[a-zA-Z0-9_.]+\s+)?["']([^"']+)["']/g;
      let itemMatch: RegExpExecArray | null;
      while ((itemMatch = itemRegex.exec(blockContent)) !== null) {
        list.push({
          rawPath: itemMatch[1],
          specifiers: [],
          statement: itemMatch[0].trim(),
        });
      }
    }
  } else if (language === 'rust') {
    const modRegex = /(?:pub(?:\([^)]+\))?\s+)?mod\s+([a-zA-Z0-9_]+)\s*;/g;
    let match: RegExpExecArray | null;
    while ((match = modRegex.exec(content)) !== null) {
      list.push({
        rawPath: match[1],
        specifiers: ['*'],
        statement: match[0],
      });
    }

    const useRegex =
      /(?:pub(?:\([^)]+\))?\s+)?use\s+(crate|super|self)::([^;]+);/g;
    while ((match = useRegex.exec(content)) !== null) {
      const prefix = match[1];
      const rest = match[2].trim();
      list.push({
        rawPath: `${prefix}::${rest}`,
        specifiers: extractRustSpecifiers(rest),
        statement: match[0],
      });
    }
  } else if (language === 'java' || language === 'kotlin') {
    const javaImport = /import\s+(?:static\s+)?([a-zA-Z0-9_.]+)(?:\s*;|\s*$)/gm;
    let match: RegExpExecArray | null;
    while ((match = javaImport.exec(content)) !== null) {
      const fullPackage = match[1];
      if (
        !fullPackage.startsWith('java.') &&
        !fullPackage.startsWith('javax.') &&
        !fullPackage.startsWith('sun.') &&
        !fullPackage.startsWith('org.junit.')
      ) {
        list.push({
          rawPath: fullPackage,
          specifiers: [fullPackage.split('.').pop() || '*'],
          statement: match[0].trim(),
        });
      }
    }
  }

  return list;
}

function extractRustSpecifiers(path: string): string[] {
  const last = path.split('::').pop() || '';
  if (last.startsWith('{') && last.endsWith('}')) {
    return last
      .slice(1, -1)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [last];
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

export function resolveImportPath(
  currentFile: string,
  importPath: string,
  fileSet: Set<string>,
  language?: string,
): string | null {
  const normCurrent = currentFile.replaceAll('\\', '/');
  const currentDir = dirname(normCurrent);

  if (language === 'rust') {
    if (importPath.startsWith('crate::')) {
      const sub = importPath.slice('crate::'.length).replaceAll('::', '/');
      for (const prefix of ['src/', '']) {
        for (const ext of ['.rs', '/mod.rs']) {
          const candidate = normalize(`${prefix}${sub}${ext}`).replaceAll(
            '\\',
            '/',
          );
          if (fileSet.has(candidate)) return candidate;
        }
      }
    } else if (importPath.startsWith('super::')) {
      const sub = importPath.slice('super::'.length).replaceAll('::', '/');
      const parentDir = dirname(currentDir);
      for (const ext of ['.rs', '/mod.rs']) {
        const candidate = normalize(join(parentDir, `${sub}${ext}`)).replaceAll(
          '\\',
          '/',
        );
        if (fileSet.has(candidate)) return candidate;
      }
    } else {
      for (const ext of ['.rs', '/mod.rs']) {
        const candidate = normalize(
          join(currentDir, `${importPath}${ext}`),
        ).replaceAll('\\', '/');
        if (fileSet.has(candidate)) return candidate;
      }
    }
    return null;
  }

  if (language === 'java' || language === 'kotlin') {
    const pathAsDir = importPath.replace(/\.\*$/, '').replaceAll('.', '/');
    for (const f of fileSet) {
      if (
        (f.endsWith(`${pathAsDir}.java`) ||
          f.endsWith(`${pathAsDir}.kt`) ||
          (importPath.endsWith('.*') && f.includes(pathAsDir))) &&
        f !== normCurrent
      ) {
        return f;
      }
    }
    return null;
  }

  if (language === 'go') {
    const cleaned = importPath.replace(/^\.\//, '');
    for (const f of fileSet) {
      if (f.endsWith('.go') && f !== normCurrent) {
        if (
          f.startsWith(cleaned) ||
          f.includes(`/${cleaned}/`) ||
          dirname(f).endsWith(cleaned)
        ) {
          return f;
        }
      }
    }
    return null;
  }

  if (!importPath.startsWith('.') && !importPath.startsWith('/')) {
    const directCandidate = importPath + '.ts';
    if (fileSet.has(directCandidate)) return directCandidate;
    return null;
  }

  const rawTarget = normalize(join(currentDir, importPath)).replaceAll(
    '\\',
    '/',
  );

  if (fileSet.has(rawTarget)) return rawTarget;

  const candidateExts = [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.go',
    '.rs',
  ];

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
