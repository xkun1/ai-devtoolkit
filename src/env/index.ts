/**
 * 环境迁移 — 编排入口
 *
 * 提供环境导出、导入的高层 API。
 */
import { resolve } from 'node:path';
import { exportEnvironment } from './exporter.js';
import {
  importEnvironment,
  loadSnapshot,
  formatImportPreview,
} from './importer.js';
import type { ExportOptions, ImportOptions } from './types.js';
import { info, success, warn } from '../utils/logger.js';

// 重导出
export {
  exportEnvironment,
  generateSetupScript,
  SNAPSHOT_VERSION,
} from './exporter.js';
export {
  importEnvironment,
  loadSnapshot,
  formatImportPreview,
} from './importer.js';
export {
  detectEnvironment,
  detectBrew,
  detectNpmGlobal,
  detectPip,
  detectSdks,
  detectVscodeExtensions,
  detectMacApps,
  detectShell,
  detectGit,
  detectSsh,
} from './detector.js';
export type {
  EnvSnapshot,
  BrewPackages,
  NpmGlobalPackage,
  PipPackage,
  SdkInfo,
  VscodeExtension,
  MacApp,
  ShellConfig,
  GitConfig,
  SshConfig,
  DetectOptions,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
  EnvModule,
} from './types.js';

/**
 * 导出环境：扫描 + 生成文件
 */
export async function exportEnv(options: ExportOptions = {}): Promise<void> {
  info('╔══════════════════════════════════════╗');
  info('║   📦 devtoolkit — 环境迁移导出        ║');
  info('╚══════════════════════════════════════╝');
  info('');

  const result = await exportEnvironment(options);

  info('  📊 扫描完成:');
  for (const [key, count] of Object.entries(result.summary.details)) {
    info('     ' + key + ': ' + count + ' 项');
  }
  info('     总计: ' + result.summary.totalItems + ' 项');
  info('');

  if (result.jsonPath) {
    success('JSON 明细: ' + result.jsonPath);
  }
  if (result.scriptPath) {
    success('安装脚本: ' + result.scriptPath);
  }
  info('');

  info('  💡 新电脑上恢复方法:');
  if (result.scriptPath) {
    info('     1. 复制 ' + result.scriptPath + ' 到新电脑');
    info('     2. 执行 bash ' + result.scriptPath.split('/').pop());
  }
  if (result.jsonPath) {
    info('     或: devtoolkit --env-import ' + result.jsonPath);
  }
  info('');
}

/**
 * 导入环境：从快照恢复
 */
export async function importEnv(
  snapshotPath: string,
  options: ImportOptions = {},
): Promise<void> {
  info('╔══════════════════════════════════════╗');
  info('║   📥 devtoolkit — 环境迁移导入        ║');
  info('╚══════════════════════════════════════╝');
  info('');

  const resolvedPath = resolve(snapshotPath);
  const snapshot = loadSnapshot(resolvedPath);

  info('  📋 快照信息:');
  info('     导出时间: ' + snapshot.exportedAt);
  info(
    '     来源: ' +
      snapshot.system.username +
      '@' +
      snapshot.system.hostname +
      ' (' +
      snapshot.system.platform +
      ')',
  );
  info('');

  const result = await importEnvironment(snapshot, options);

  if (!options.execute) {
    // dry-run 模式
    console.log(formatImportPreview(result));
  } else {
    // 执行模式
    info('🚀 开始恢复...');
    let successCount = 0;
    let failCount = 0;

    for (const r of result.results) {
      if (r.success) {
        successCount++;
      } else {
        failCount++;
        warn('✖ ' + r.command.slice(0, 80));
      }
    }

    info('');
    if (successCount > 0) {
      success('✅ 成功: ' + successCount + ' 条命令');
    }
    if (failCount > 0) {
      warn('⚠️  失败: ' + failCount + ' 条命令');
    }
    if (result.skipped.length > 0) {
      warn('⏭️  跳过: ' + result.skipped.length + ' 项');
      for (const s of result.skipped) {
        info('     - ' + s);
      }
    }
    info('');
  }
}
