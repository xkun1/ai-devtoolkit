/**
 * 环境导出器
 *
 * 将环境快照导出为：
 * 1. JSON 明细文件（机器可读）
 * 2. setup.sh 安装脚本（可直接执行）
 */
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { EnvSnapshot, ExportOptions, ExportResult } from './types.js';
import { detectEnvironment } from './detector.js';

export const SNAPSHOT_VERSION = '1.0.0';

/** 导出环境快照 */
export async function exportEnvironment(
  options: ExportOptions = {},
): Promise<ExportResult> {
  const outputDir = options.outputDir || process.cwd();
  const prefix = options.outputPrefix || 'devtoolkit-env';
  const generateScript = options.generateScript ?? true;
  const generateJson = options.generateJson ?? true;

  // 1. 探测环境
  const snapshot = await detectEnvironment(options);

  // 2. 确保输出目录存在
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const files: string[] = [];
  let jsonPath: string | undefined;
  let scriptPath: string | undefined;

  // 3. 生成 JSON 明细
  if (generateJson) {
    jsonPath = join(outputDir, prefix + '.json');
    await writeFile(jsonPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    files.push(jsonPath);
  }

  // 4. 生成 setup.sh 安装脚本
  if (generateScript) {
    scriptPath = join(outputDir, prefix + '-setup.sh');
    const script = generateSetupScript(snapshot);
    await writeFile(scriptPath, script, 'utf-8');
    // 设置可执行权限
    const { chmod } = await import('node:fs/promises');
    await chmod(scriptPath, 0o755);
    files.push(scriptPath);
  }

  // 5. 统计
  const details: Record<string, number> = {};
  if (snapshot.brew) {
    details['brew-formulae'] = snapshot.brew.formulae.length;
    details['brew-casks'] = snapshot.brew.casks.length;
  }
  if (snapshot.npmGlobal) details['npm-global'] = snapshot.npmGlobal.length;
  if (snapshot.pipPackages) details['pip'] = snapshot.pipPackages.length;
  if (snapshot.sdks) details['sdks'] = snapshot.sdks.length;
  if (snapshot.vscodeExtensions)
    details['vscode-extensions'] = snapshot.vscodeExtensions.length;
  if (snapshot.macApps) details['mac-apps'] = snapshot.macApps.length;
  if (snapshot.shell) details['shell-files'] = snapshot.shell.files.length;

  const totalItems = Object.values(details).reduce((a, b) => a + b, 0);

  return {
    snapshot,
    files,
    scriptPath,
    jsonPath,
    summary: { totalItems, details },
  };
}

/** 生成 setup.sh 安装脚本 */
export function generateSetupScript(snapshot: EnvSnapshot): string {
  const lines: string[] = [];

  lines.push('#!/usr/bin/env bash');
  lines.push('# ============================================================');
  lines.push('# devtoolkit 环境迁移脚本');
  lines.push('# 导出时间: ' + snapshot.exportedAt);
  lines.push(
    '# 系统: ' + snapshot.system.platform + '/' + snapshot.system.arch,
  );
  lines.push(
    '# 用户: ' + snapshot.system.username + '@' + snapshot.system.hostname,
  );
  lines.push('# ============================================================');
  lines.push('set -euo pipefail');
  lines.push('');
  lines.push('echo "🚀 开始恢复开发环境..."');
  lines.push('');

  // ── Homebrew ──
  if (
    snapshot.brew &&
    (snapshot.brew.formulae.length > 0 || snapshot.brew.casks.length > 0)
  ) {
    lines.push('# ── Homebrew ──');
    lines.push('if ! command -v brew &>/dev/null; then');
    lines.push('  echo "📦 安装 Homebrew..."');
    lines.push(
      '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
    );
    lines.push('fi');
    lines.push('');

    if (snapshot.brew.formulae.length > 0) {
      lines.push(
        'echo "🍺 安装 Homebrew Formulae (' +
          snapshot.brew.formulae.length +
          ' 个)..."',
      );
      lines.push('brew install ' + snapshot.brew.formulae.join(' '));
      lines.push('');
    }

    if (snapshot.brew.casks.length > 0) {
      lines.push(
        'echo "🍷 安装 Homebrew Casks (' +
          snapshot.brew.casks.length +
          ' 个)..."',
      );
      lines.push('brew install --cask ' + snapshot.brew.casks.join(' '));
      lines.push('');
    }
  }

  // ── npm 全局包 ──
  if (snapshot.npmGlobal && snapshot.npmGlobal.length > 0) {
    lines.push('# ── npm 全局包 ──');
    const names = snapshot.npmGlobal
      .filter((p) => !['npm', 'corepack'].includes(p.name))
      .map((p) => p.name);
    if (names.length > 0) {
      lines.push('echo "📦 安装 npm 全局包 (' + names.length + ' 个)..."');
      lines.push('npm install -g ' + names.join(' '));
      lines.push('');
    }
  }

  // ── pip 包 ──
  if (snapshot.pipPackages && snapshot.pipPackages.length > 0) {
    const filtered = snapshot.pipPackages.filter(
      (p) => !['pip', 'setuptools', 'wheel', 'pkg-resources'].includes(p.name),
    );
    if (filtered.length > 0) {
      lines.push('# ── pip 包 ──');
      lines.push('echo "🐍 安装 pip 包 (' + filtered.length + ' 个)..."');
      lines.push(
        'pip3 install ' +
          filtered.map((p) => p.name + '==' + p.version).join(' '),
      );
      lines.push('');
    }
  }

  // ── VSCode 扩展 ──
  if (snapshot.vscodeExtensions && snapshot.vscodeExtensions.length > 0) {
    const uniqueExts = [...new Set(snapshot.vscodeExtensions.map((e) => e.id))];
    lines.push('# ── VSCode 扩展 ──');
    lines.push('echo "🖥️  安装 VSCode 扩展 (' + uniqueExts.length + ' 个)..."');
    for (const id of uniqueExts) {
      lines.push('code --install-extension ' + id + ' 2>/dev/null || true');
    }
    lines.push('');
  }

  // ── Shell 配置 ──
  if (snapshot.shell && snapshot.shell.files.length > 0) {
    lines.push('# ── Shell 配置文件 ──');
    lines.push('echo "⚙️  恢复 Shell 配置..."');
    for (const f of snapshot.shell.files) {
      lines.push('echo "  写入 ~/' + f.name + ' (请确认后执行)"');
      lines.push('# 内容见 JSON 明细中的 shell.files[].content 字段');
      lines.push('# 手动复制 JSON 中的内容到 ~/' + f.name);
    }
    lines.push('');
  }

  // ── Git 配置 ──
  if (snapshot.git) {
    lines.push('# ── Git 全局配置 ──');
    lines.push('echo "🔧 恢复 Git 配置..."');
    const configLines = snapshot.git.config.split('\n').filter(Boolean);
    for (const line of configLines) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        lines.push('git config --global ' + key + ' "' + value + '"');
      }
    }
    lines.push('');
  }

  // ── SSH 提示 ──
  if (snapshot.ssh && snapshot.ssh.hasKeys) {
    lines.push('# ── SSH 配置 ──');
    lines.push('echo "🔑 检测到 SSH 私钥（出于安全考虑未自动迁移）"');
    lines.push('echo "   请手动复制 ~/.ssh/ 下的私钥文件到新电脑"');
    lines.push('echo "   SSH config 内容见 JSON 明细"');
    lines.push('');
  }

  // ── macOS 应用提示 ──
  if (snapshot.macApps && snapshot.macApps.length > 0) {
    const manualApps = snapshot.macApps.filter((a) => a.manual);
    if (manualApps.length > 0) {
      lines.push('# ── macOS 应用（手动安装）──');
      lines.push('echo "📱 以下应用需要手动安装:"');
      for (const app of manualApps) {
        lines.push('echo "  - ' + app.name + '"');
      }
      lines.push('');
    }
  }

  lines.push('echo ""');
  lines.push('echo "✅ 环境恢复完成！"');
  lines.push(
    'echo "💡 提示: Shell 配置和 SSH 私钥需手动迁移，请查看 JSON 明细"',
  );
  lines.push('');

  return lines.join('\n');
}
