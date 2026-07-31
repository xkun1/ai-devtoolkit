/**
 * Watch 模式：监控源文档变更，自动重新生成技能包
 *
 * 支持监控本地文件。URL 类型无法监控文件变更，仅本地文件。
 */
import { watch } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PipelineOptions } from './types/index.js';
import { runPipeline } from './pipeline.js';
import { info, success, warn, error } from './utils/logger.js';

/** 防抖延迟（ms） */
const DEBOUNCE_MS = 500;

/**
 * 启动 watch 模式
 * @returns 停止监控的函数
 */
export function startWatch(
  sources: string[],
  options: PipelineOptions,
): () => void {
  // 只监控本地文件
  const localFiles = sources.filter((s) => !/^https?:\/\//i.test(s));
  const urlSources = sources.filter((s) => /^https?:\/\//i.test(s));

  if (localFiles.length === 0) {
    warn('watch 模式仅支持本地文件，URL 无法监控变更');
    return () => {};
  }

  if (urlSources.length > 0) {
    warn(`URL 来源 (${urlSources.length} 个) 无法监控，仅监控本地文件`);
  }

  info(`  👀 正在监控 ${localFiles.length} 个文件...`);
  info('     Ctrl+C 退出');
  info('');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const trigger = () => {
    if (running) return; // 防止并发
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      running = true;
      try {
        info('');
        success('检测到变更，重新生成...');
        await runPipeline(sources, options);
        info(`  👀 继续监控...`);
      } catch (err: any) {
        error(`重新生成失败: ${err.message}`);
      } finally {
        running = false;
      }
    }, DEBOUNCE_MS);
  };

  // 初始生成一次
  info('  🚀 首次生成...');
  runPipeline(sources, options)
    .then(() => info(`  👀 继续监控...`))
    .catch((err) => error(`首次生成失败: ${err.message}`));

  // 设置 watchers
  const watchers: ReturnType<typeof watch>[] = [];
  for (const file of localFiles) {
    const resolved = resolve(file);
    if (!existsSync(resolved)) {
      warn(`文件不存在: ${file}`);
      continue;
    }
    try {
      const w = watch(resolved, () => {
        info(`  📝 变更: ${file}`);
        trigger();
      });
      watchers.push(w);
    } catch (err: any) {
      warn(`无法监控 ${file}: ${err.message}`);
    }
  }

  // 返回停止函数
  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    for (const w of watchers) w.close();
    info('\n  👋 已停止监控');
  };
}
