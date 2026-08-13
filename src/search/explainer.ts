/**
 * LLM 智能解释器
 *
 * 将搜索结果交给 LLM，生成自然语言解释和代码摘要。
 * 复用项目已有的 callLLM 基础设施。
 */
import type { ExplainOptions, SearchResult } from './types.js';
import { callLLM } from '../transform/llm.js';

/** 反引号常量，避免模板字符串中的转义问题 */
const BT = '`';
const BT3 = BT + BT + BT;

/**
 * 用 LLM 解释搜索结果
 *
 * 将匹配的代码片段和用户的问题一起交给 LLM，
 * 生成中文解释、相关代码位置说明和导航建议。
 */
export async function explainResults(options: ExplainOptions): Promise<string> {
  const { query, results, projectRoot } = options;

  if (results.length === 0) {
    return '未找到匹配的代码。请尝试用不同的关键词搜索，或先运行 `devtoolkit --scan-code` 初始化索引。';
  }

  // 构建上下文（控制 token 量，最多取前 5 条结果）
  const topResults = results.slice(0, 5);
  const parts: string[] = [];

  for (let i = 0; i < topResults.length; i++) {
    const r = topResults[i];
    const chunk = r.chunk;
    // 截取关键片段（最多 40 行）
    const lines = chunk.content.split('\n');
    const preview = lines.slice(0, 40).join('\n');
    const truncationNote = lines.length > 40 ? '\n... (已截断)' : '';

    const symbolInfo =
      r.matchedSymbols.length > 0
        ? `**匹配符号**: ${r.matchedSymbols.join(', ')}`
        : '';
    const keywordInfo =
      r.matchedKeywords.length > 0
        ? `**匹配关键词**: ${r.matchedKeywords.join(', ')}`
        : '';

    parts.push(
      `### 结果 ${i + 1} (相关性: ${(r.score * 100).toFixed(0)}%)\n` +
        `**文件**: ${chunk.file}\n` +
        `**行号**: ${chunk.startLine}-${chunk.endLine}\n` +
        `**语言**: ${chunk.language}\n` +
        (symbolInfo ? symbolInfo + '\n' : '') +
        (keywordInfo ? keywordInfo + '\n' : '') +
        '\n' +
        BT3 +
        chunk.language +
        '\n' +
        preview +
        truncationNote +
        '\n' +
        BT3,
    );
  }

  const context = parts.join('\n\n---\n\n');

  const prompt =
    `你是代码分析专家。用户在一个项目中搜索"${query}"，以下是按相关性排序的搜索结果。\n` +
    '请用中文分析这些代码，回答用户的问题。\n\n' +
    '## 要求\n' +
    '1. 先给出一句话总结：这些代码大概是在做什么\n' +
    '2. 列出关键文件和位置，说明每个位置的作用\n' +
    '3. 如果用户问的是"XX功能在哪里实现"，直接指明具体文件和行号\n' +
    '4. 如果搜索结果与查询不完全相关，指出最相关的部分\n' +
    '5. 回答简洁，用中文，适当使用 markdown 格式\n' +
    `6. 使用项目根目录 ${projectRoot} 作为路径前缀\n\n` +
    '## 搜索结果\n' +
    context;

  return callLLM(prompt, options.llm);
}

/**
 * 格式化搜索结果为终端友好输出（不使用 LLM）
 */
export function formatResultsPlain(
  results: SearchResult[],
  projectRoot: string,
  showContent = true,
): string {
  if (results.length === 0) {
    return '❌ 未找到匹配结果。请尝试其他关键词，或运行 `devtoolkit --scan-code` 初始化索引。';
  }

  const lines: string[] = [];
  lines.push(`\n🔍 找到 ${results.length} 条结果:\n`);
  lines.push('─'.repeat(60));

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const chunk = r.chunk;

    lines.push(
      `\n[${i + 1}] 📄 ${chunk.file}:${chunk.startLine}-${chunk.endLine}`,
    );
    lines.push(
      `    语言: ${chunk.language} | 相关性: ${(r.score * 100).toFixed(0)}%`,
    );

    if (r.matchedSymbols.length > 0) {
      lines.push(`    🏷️  符号: ${r.matchedSymbols.join(', ')}`);
    }
    if (r.matchedKeywords.length > 0) {
      lines.push(`    🔑 关键词: ${r.matchedKeywords.slice(0, 8).join(', ')}`);
    }

    if (showContent) {
      // 显示匹配代码片段（最多 15 行）
      const codeLines = chunk.content.split('\n');
      const previewLines = codeLines.slice(0, 15);
      const truncationNote =
        codeLines.length > 15 ? `\n    ... (+${codeLines.length - 15} 行)` : '';

      lines.push('');
      for (const codeLine of previewLines) {
        lines.push(`    ${codeLine}`);
      }
      if (truncationNote) {
        lines.push(`    ${truncationNote}`);
      }
    }

    lines.push('─'.repeat(60));
  }

  return lines.join('\n');
}
