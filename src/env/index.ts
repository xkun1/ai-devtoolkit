/**
 * 环境迁移模块统一入口
 */
import { resolve } from 'node:path';
import type {
  DetectOptions,
  EnvSnapshot,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
  EnvDiffResult,
  DiffItem,
  BrewPackages,
  NpmGlobalPackage,
  PipPackage,
  SdkInfo,
  VscodeExtension,
  MacApp,
  ShellConfig,
  GitConfig,
  SshConfig,
  EnvModule,
} from './types.js';
import {
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
import {
  exportEnvironment,
  generateSetupScript,
  SNAPSHOT_VERSION,
} from './exporter.js';
import {
  importEnvironment,
  loadSnapshot,
  formatImportPreview,
  diffEnvironment,
  formatDiffPreview,
} from './importer.js';
import { info, success } from '../utils/logger.js';
import { validateEnvSnapshot } from './validate.js';

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
  exportEnvironment,
  generateSetupScript,
  SNAPSHOT_VERSION,
  importEnvironment,
  loadSnapshot,
  formatImportPreview,
  diffEnvironment,
  formatDiffPreview,
  validateEnvSnapshot,
};
export type {
  DetectOptions,
  EnvSnapshot,
  ExportOptions,
  ExportResult,
  ImportOptions,
  ImportResult,
  EnvDiffResult,
  DiffItem,
  BrewPackages,
  NpmGlobalPackage,
  PipPackage,
  SdkInfo,
  VscodeExtension,
  MacApp,
  ShellConfig,
  GitConfig,
  SshConfig,
  EnvModule,
};

/**
 * 导出当前环境（CLI 包装）
 */
export async function exportEnv(
  options: ExportOptions = {},
): Promise<ExportResult> {
  info('🔍 正在扫描当前开发环境...');
  const result = await exportEnvironment(options);

  success(`环境导出完成！总计扫描 ${result.summary.totalItems} 项配置`);
  info('');
  info('📄 生成的文件:');
  if (result.jsonPath) {
    info(`  - JSON 明细: ${result.jsonPath}`);
  }
  if (result.scriptPath) {
    info(`  - 安装脚本: ${result.scriptPath}`);
  }
  info('');
  info('💡 换新电脑时，可以通过以下方式恢复:');
  info('   1. 运行安装脚本: bash devtoolkit-env-setup.sh');
  info('   2. 使用 devtoolkit: devtoolkit --env-import devtoolkit-env.json');
  info('   3. 比对环境差异: devtoolkit --env-diff devtoolkit-env.json');

  return result;
}

/**
 * 导入环境（CLI 包装）
 */
export async function importEnv(
  snapshotPath: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const absPath = resolve(snapshotPath);
  info(`📦 正在加载环境快照: ${absPath}`);
  const snapshot = loadSnapshot(absPath);

  const result = await importEnvironment(snapshot, options);

  if (!options.execute) {
    info(formatImportPreview(result));
  } else {
    const successCount = result.results.filter((r) => r.success).length;
    const failCount = result.results.filter((r) => !r.success).length;
    success(
      `环境恢复完成！成功执行 ${successCount} 条命令${failCount > 0 ? `，${failCount} 条失败` : ''}`,
    );
  }

  return result;
}

/**
 * 比对环境差异（CLI 包装）
 */
export async function diffEnv(snapshotPath: string): Promise<EnvDiffResult> {
  const absPath = resolve(snapshotPath);
  info(`🔍 正在比对当前环境与快照: ${absPath}`);
  const snapshot = loadSnapshot(absPath);
  const diff = await diffEnvironment(snapshot);

  info(formatDiffPreview(diff));
  return diff;
}
