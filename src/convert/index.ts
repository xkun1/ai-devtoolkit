/**
 * 跨 Agent 规则互转与同步模块统一入口
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AgentType } from '../types/index.js';
import type {
  ConvertOptions,
  ConvertResult,
  ParsedRule,
  RuleFormat,
  RuleMetadata,
  SyncOptions,
  SyncResult,
  SyncOperation,
  DiscoveredRules,
} from './types.js';
import { parseRule, detectRuleFormat } from './parser.js';
import { convertRule } from './converter.js';
import { discoverProjectRules, syncProjectRules } from './syncer.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import { info, success, warn } from '../utils/logger.js';

export {
  parseRule,
  detectRuleFormat,
  convertRule,
  discoverProjectRules,
  syncProjectRules,
};

export type {
  ConvertOptions,
  ConvertResult,
  ParsedRule,
  RuleFormat,
  RuleMetadata,
  SyncOptions,
  SyncResult,
  SyncOperation,
  DiscoveredRules,
};

/**
 * 转换单个规则文件（CLI 包装）
 */
export async function convertFile(
  filePath: string,
  targetAgent: AgentType,
  options: { name?: string; outputDir?: string; write?: boolean } = {},
): Promise<ConvertResult> {
  const absPath = resolve(filePath);
  const content = await readFile(absPath, 'utf-8');
  const parsed = parseRule(content, absPath);

  const result = convertRule(parsed, {
    to: targetAgent,
    name: options.name,
    outputDir: options.outputDir,
  });

  if (options.write !== false) {
    for (const art of result.artifacts) {
      await writeFileAtomic(art.path, art.content);
      success(`已生成 ${targetAgent} 规则: ${art.path}`);
    }
  }

  return result;
}

/**
 * 同步项目全部规则（CLI 包装）
 */
export async function syncRules(
  options: SyncOptions = {},
): Promise<SyncResult> {
  info('🔍 正在扫描项目已存在的 Agent 规则...');
  const result = await syncProjectRules(options);

  if (result.discovered.length === 0) {
    warn(
      '未在项目中检测到已有的规则文件（.cursor/rules/, .agents/skills/, CLAUDE.md）',
    );
    return result;
  }

  info(
    `📋 发现 ${result.discovered.length} 处规则源，共 ${result.summary.totalDiscovered} 个规则文件`,
  );
  info('');

  for (const op of result.operations) {
    if (op.action === 'created') {
      success(`[新建] -> ${op.targetAgent}: ${op.targetPath}`);
    } else if (op.action === 'updated') {
      info(`  [更新] -> ${op.targetAgent}: ${op.targetPath}`);
    } else {
      info(`  [跳过] -> ${op.targetAgent}: ${op.targetPath} (内容一致)`);
    }
  }

  info('');
  if (options.dryRun) {
    info('💡 当前为 dry-run 预览模式，未写入文件');
  } else {
    success(`✨ 同步完成！共分发 ${result.summary.totalSynced} 项产物`);
  }

  return result;
}
