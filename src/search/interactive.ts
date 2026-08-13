/**
 * 交互式搜索 REPL
 *
 * 初始化索引后进入持续搜索模式，用户可以反复搜索。
 */
import { createInterface } from 'node:readline';
import type { SearchIndex } from './types.js';
import { searchCode } from './searcher.js';
import { explainResults, formatResultsPlain } from './explainer.js';
import type { LLMConfig } from '../types/index.js';
import { info, warn } from '../utils/logger.js';

export interface InteractiveOptions {
  index: SearchIndex;
  llm?: LLMConfig;
  useExplain: boolean;
}

/**
 * 启动交互式搜索 REPL
 */
export function startInteractiveSearch(options: InteractiveOptions): void {
  const { index, llm, useExplain } = options;

  info('');
  info('╔══════════════════════════════════════════╗');
  info('║   🔍 交互式代码搜索 (输入 :q 退出)       ║');
  info('╚══════════════════════════════════════════╝');
  info('');
  info('  💡 直接输入搜索关键词或自然语言问题');
  info('  💡 例如: 用户登录验证 / pagination / UserController');
  info('  💡 输入 :q 退出，:plain 切换纯文本/LLM模式');
  info('');

  let plainMode = !useExplain || !llm;
  if (useExplain && !llm) {
    warn('⚠️ 未配置 LLM，自动切换到纯文本模式');
    plainMode = true;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '🔍 > ',
  });

  rl.prompt();

  rl.on('line', async (input: string) => {
    const query = input.trim();

    if (!query) {
      rl.prompt();
      return;
    }

    if (query === ':q' || query === ':quit' || query === ':exit') {
      rl.close();
      return;
    }

    if (query === ':plain') {
      plainMode = !plainMode;
      info(`已切换到 ${plainMode ? '纯文本' : 'LLM 解释'} 模式`);
      rl.prompt();
      return;
    }

    if (query === ':stats') {
      info(
        `📊 索引统计: ${index.stats.totalFiles} 文件 / ${index.stats.totalChunks} 分块 / ${index.stats.totalSymbols} 符号`,
      );
      const langList = Object.entries(index.stats.languages)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `${lang}(${count})`)
        .join(', ');
      info(`   语言分布: ${langList}`);
      rl.prompt();
      return;
    }

    // 执行搜索
    const results = searchCode(index, query, { limit: 10 });

    if (plainMode || !llm) {
      console.log(formatResultsPlain(results, index.projectRoot));
      rl.prompt();
    } else {
      // LLM 解释模式
      info('🤖 正在分析...');
      try {
        const explanation = await explainResults({
          llm,
          query,
          results,
          projectRoot: index.projectRoot,
        });
        console.log('\n' + explanation);
      } catch (err: any) {
        warn(`LLM 解释失败: ${err.message}，回退到纯文本模式`);
        console.log(formatResultsPlain(results, index.projectRoot));
      }
      rl.prompt();
    }
  });

  rl.on('close', () => {
    info('\n👋 已退出搜索');
    process.exit(0);
  });
}
