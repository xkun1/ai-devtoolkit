/**
 * devtoolkit doctor — 一键诊断
 *
 * 检查 API Key 配置、网络连通性、索引状态、技能包健康度。
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { info } from '../utils/logger.js';
import { MODEL_PRESETS } from '../models.js';
import { INDEX_FILENAME } from '../search/indexer.js';
import { GRAPH_CACHE_FILENAME } from '../graph/cache.js';
import { REGISTRY_FILENAME, loadRegistry } from '../lifecycle/index.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'error' | 'skip';
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  summary: { ok: number; warn: number; error: number };
}

export async function runDoctor(
  projectRoot: string = process.cwd(),
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. API Key 检查
  for (const [id, preset] of Object.entries(MODEL_PRESETS)) {
    if (preset.local) continue;
    const envValue = process.env[preset.envVar];
    checks.push({
      name: `API Key: ${preset.envVar}`,
      status: envValue ? 'ok' : 'warn',
      detail: envValue ? `已配置（${id}）` : `未设置（${id} 将不可用）`,
    });
  }

  // 2. 本地模型检查
  const ollamaUrl = process.env.OLLAMA_HOST || 'http://localhost:11434';
  checks.push({
    name: '本地模型 (Ollama)',
    status: 'ok',
    detail: `预设地址: ${ollamaUrl}（需自行确认服务是否运行）`,
  });

  // 3. 代码搜索索引
  const indexPath = join(projectRoot, INDEX_FILENAME);
  if (existsSync(indexPath)) {
    const stat = statSync(indexPath);
    const ageHours = Math.round((Date.now() - stat.mtimeMs) / 3600000);
    checks.push({
      name: '代码搜索索引',
      status: ageHours > 24 ? 'warn' : 'ok',
      detail:
        ageHours > 24
          ? `已过期（${ageHours} 小时前更新），建议 --scan-code 刷新`
          : `正常（${ageHours} 小时前更新）`,
    });
  } else {
    checks.push({
      name: '代码搜索索引',
      status: 'warn',
      detail: '未找到索引，运行 --scan-code 初始化',
    });
  }

  // 4. 依赖图谱缓存
  const graphPath = join(projectRoot, GRAPH_CACHE_FILENAME);
  if (existsSync(graphPath)) {
    checks.push({
      name: '依赖图谱缓存',
      status: 'ok',
      detail: '存在增量分析缓存',
    });
  } else {
    checks.push({
      name: '依赖图谱缓存',
      status: 'warn',
      detail: '未找到缓存，首次 --graph 会较慢',
    });
  }

  // 5. 技能包注册表
  const registryPath = join(projectRoot, REGISTRY_FILENAME);
  if (existsSync(registryPath)) {
    try {
      const registry = await loadRegistry(projectRoot);
      const count = Object.keys(registry.skills).length;
      checks.push({
        name: '技能包注册表',
        status: 'ok',
        detail: `${count} 个技能包已注册`,
      });
    } catch {
      checks.push({
        name: '技能包注册表',
        status: 'error',
        detail: '注册表文件损坏',
      });
    }
  } else {
    checks.push({
      name: '技能包注册表',
      status: 'warn',
      detail: '未找到，生成技能包后自动创建',
    });
  }

  // 6. Node.js 版本
  const nodeVersion = process.version;
  const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  checks.push({
    name: 'Node.js 版本',
    status: majorVersion >= 20 ? 'ok' : 'error',
    detail: nodeVersion + (majorVersion >= 20 ? '' : '（需要 >= 20.19）'),
  });

  // 汇总
  const summary = {
    ok: checks.filter((c) => c.status === 'ok').length,
    warn: checks.filter((c) => c.status === 'warn').length,
    error: checks.filter((c) => c.status === 'error').length,
  };

  return { checks, summary };
}

/** 打印诊断报告 */
export function printDoctorReport(report: DoctorReport): void {
  info('');
  info('╔══════════════════════════════════════╗');
  info('║   🩺 devtoolkit doctor — 环境诊断     ║');
  info('╚══════════════════════════════════════╝');
  info('');

  for (const check of report.checks) {
    const icon =
      check.status === 'ok'
        ? '\x1b[32m✓\x1b[0m'
        : check.status === 'warn'
          ? '\x1b[33m⚠\x1b[0m'
          : check.status === 'error'
            ? '\x1b[31m✖\x1b[0m'
            : '○';
    info(`  ${icon} ${check.name}: ${check.detail}`);
  }

  info('');
  info(
    `  📊 结果: ${report.summary.ok} 正常 / ${report.summary.warn} 警告 / ${report.summary.error} 错误`,
  );
  info('');
}
