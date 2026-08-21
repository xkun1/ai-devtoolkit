/**
 * Repo Map 生成器
 *
 * 生成项目结构摘要（类似 Aider 的 repo map），一键输出给任何 Agent 当上下文。
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LanguageId } from '../search/types.js';
import { scanCodeFiles } from '../search/scanner.js';

export interface RepoMapOptions {
  root?: string;
  /** 每个文件最多显示的符号数 */
  maxSymbolsPerFile?: number;
  /** 最大输出字符数 */
  maxChars?: number;
}

export interface RepoMapEntry {
  path: string;
  language: LanguageId;
  symbols: string[];
  lines: number;
}

/** 生成项目 Repo Map */
export async function generateRepoMap(
  options: RepoMapOptions = {},
): Promise<string> {
  const root = options.root || process.cwd();
  const maxSymbols = options.maxSymbolsPerFile ?? 8;
  const maxChars = options.maxChars ?? 8000;

  const files = await scanCodeFiles({ root, maxDepth: 10 });
  const { extractSymbols } = await import('../search/scanner.js');

  const entries: RepoMapEntry[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(join(root, file.path), 'utf-8');
    } catch {
      continue;
    }
    const symbols = extractSymbols(content, file.language, file.path)
      .slice(0, maxSymbols)
      .map((s) => `${s.kind} ${s.name}`);
    entries.push({
      path: file.path,
      language: file.language,
      symbols,
      lines: file.lines,
    });
  }

  // 按目录分组
  const groups: Record<string, RepoMapEntry[]> = {};
  for (const entry of entries) {
    const dir = entry.path.split('/').slice(0, -1).join('/') || '.';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(entry);
  }

  const lines: string[] = [];
  lines.push(`# Repo Map (${entries.length} files)`);
  lines.push('');

  const sortedDirs = Object.keys(groups).sort();
  for (const dir of sortedDirs) {
    lines.push(`## ${dir}/`);
    for (const entry of groups[dir]) {
      const fileName = entry.path.split('/').pop() || entry.path;
      const symbolStr =
        entry.symbols.length > 0 ? ` → ${entry.symbols.join(', ')}` : '';
      lines.push(
        `- ${fileName} (${entry.language}, ${entry.lines}L)${symbolStr}`,
      );
    }
    lines.push('');
  }

  let output = lines.join('\n');
  if (output.length > maxChars) {
    output = output.slice(0, maxChars) + '\n... (truncated)';
  }
  return output;
}
