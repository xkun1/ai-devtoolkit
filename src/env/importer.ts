/**
 * 环境导入器
 *
 * 从环境快照 JSON 中恢复开发环境。
 * 支持 dry-run 模式（默认）和实际执行模式。
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type {
  EnvSnapshot,
  EnvModule,
  ImportOptions,
  ImportResult,
  EnvDiffResult,
  DiffItem,
} from './types.js';
import { detectEnvironment } from './detector.js';
import { validateEnvSnapshot } from './validate.js';

const MAX_SNAPSHOT_BYTES = 20 * 1024 * 1024;

/** 安全执行命令 */
function exec(
  executable: string,
  args: string[],
  timeoutMs = 60000,
): { success: boolean; output: string } {
  try {
    const output = execFileSync(executable, args, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return { success: true, output };
  } catch (err: any) {
    return {
      success: false,
      output: (err.stderr || err.stdout || err.message || '')
        .trim()
        .slice(0, 500),
    };
  }
}

function has(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [cmd], {
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * 从 JSON 文件加载环境快照
 */
export function loadSnapshot(filePath: string): EnvSnapshot {
  if (!existsSync(filePath)) {
    throw new Error('快照文件不存在: ' + filePath);
  }
  if (statSync(filePath).size > MAX_SNAPSHOT_BYTES) {
    throw new Error('快照文件超过 20 MiB 限制');
  }
  const raw = readFileSync(filePath, 'utf-8');
  const snapshot: unknown = JSON.parse(raw);
  validateEnvSnapshot(snapshot);

  return snapshot;
}

/**
 * 导入环境（恢复到当前机器）
 *
 * 默认 dry-run 模式，只生成命令列表不执行。
 * 设置 options.execute = true 实际执行。
 */
export async function importEnvironment(
  snapshot: EnvSnapshot,
  options: ImportOptions = {},
): Promise<ImportResult> {
  validateEnvSnapshot(snapshot);
  const execute = options.execute ?? false;
  const enabledModules = options.modules;

  const isEnabled = (mod: EnvModule): boolean =>
    !enabledModules || enabledModules.includes(mod);

  const commands: string[] = [];
  const results: { command: string; success: boolean; output: string }[] = [];
  const skipped: string[] = [];

  const schedule = (
    executable: string,
    args: string[],
    missingLabel: string,
    timeoutMs: number,
  ) => {
    const command = formatCommand(executable, args);
    commands.push(command);
    if (!execute) return;
    if (!has(executable)) {
      if (!skipped.includes(missingLabel)) skipped.push(missingLabel);
      return;
    }
    results.push({
      command,
      ...exec(executable, args, timeoutMs),
    });
  };

  // ── Homebrew ──
  if (isEnabled('brew') && snapshot.brew) {
    const formulae = snapshot.brew.formulae;
    const casks = snapshot.brew.casks;

    if (formulae.length > 0) {
      schedule(
        'brew',
        ['install', ...formulae],
        'brew (Homebrew 未安装)',
        options.brewTimeout || 300000,
      );
    }

    if (casks.length > 0) {
      schedule(
        'brew',
        ['install', '--cask', ...casks],
        'brew-cask (Homebrew 未安装)',
        options.brewTimeout || 300000,
      );
    }
  }

  // ── npm ──
  if (isEnabled('npm') && snapshot.npmGlobal && snapshot.npmGlobal.length > 0) {
    const names = snapshot.npmGlobal
      .filter((p) => !['npm', 'corepack'].includes(p.name))
      .map((p) => p.name);
    if (names.length > 0) {
      schedule(
        'npm',
        ['install', '-g', ...names],
        'npm (Node.js 未安装)',
        120000,
      );
    }
  }

  // ── pip ──
  if (
    isEnabled('pip') &&
    snapshot.pipPackages &&
    snapshot.pipPackages.length > 0
  ) {
    const filtered = snapshot.pipPackages.filter(
      (p) => !['pip', 'setuptools', 'wheel', 'pkg-resources'].includes(p.name),
    );
    if (filtered.length > 0) {
      const pipExecutable =
        execute && !has('pip3') && has('pip') ? 'pip' : 'pip3';
      schedule(
        pipExecutable,
        ['install', ...filtered.map((p) => p.name + '==' + p.version)],
        'pip (Python/pip 未安装)',
        120000,
      );
    }
  }

  // ── VSCode 扩展 ──
  if (
    isEnabled('vscode') &&
    snapshot.vscodeExtensions &&
    snapshot.vscodeExtensions.length > 0
  ) {
    for (const ext of snapshot.vscodeExtensions) {
      schedule(
        'code',
        ['--install-extension', ext.id],
        'vscode (VSCode CLI 未安装)',
        30000,
      );
    }
  }

  // ── Git 配置 ──
  if (isEnabled('git') && snapshot.git) {
    const configLines = snapshot.git.config.split('\n').filter(Boolean);
    for (const line of configLines) {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (!isSafeGitKey(key)) {
          throw new Error(`快照包含不安全的 Git 配置键: ${key}`);
        }
        if (value.includes('***MASKED***')) {
          commands.push(`# 跳过敏感 Git 配置 ${key}（需手动填写）`);
          if (execute) skipped.push(`git:${key} (敏感值需手动填写)`);
          continue;
        }
        schedule(
          'git',
          ['config', '--global', '--', key, value],
          'git (Git 未安装)',
          5000,
        );
      }
    }
  }

  // ── Shell 配置（dry-run 只生成命令，不自动覆盖）──
  if (isEnabled('shell') && snapshot.shell) {
    for (const f of snapshot.shell.files) {
      const cmd = '# 手动写入 ~/' + f.name + ' (内容见 JSON 快照)';
      commands.push(cmd);
      if (execute) {
        skipped.push('shell:' + f.name + ' (需手动确认)');
      }
    }
  }

  // ── SSH ──
  if (isEnabled('ssh') && snapshot.ssh && snapshot.ssh.hasKeys) {
    commands.push('# 手动复制 ~/.ssh/ 私钥（安全考虑不自动迁移）');
    if (execute) {
      skipped.push('ssh (私钥需手动迁移)');
    }
  }

  return { commands, results, skipped };
}

function formatCommand(executable: string, args: string[]): string {
  return [executable, ...args].map(quoteForDisplay).join(' ');
}

function isSafeGitKey(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith('-') &&
    !value.includes('=') &&
    ![...value].some((char) => char.charCodeAt(0) <= 0x20)
  );
}

function quoteForDisplay(value: string): string {
  if (/^[A-Za-z0-9@%_+=:,./-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/**
 * 生成 dry-run 预览
 */
export function formatImportPreview(result: ImportResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(
    '📋 即将执行 ' + result.commands.length + ' 条命令 (dry-run 模式):',
  );
  lines.push('─'.repeat(60));

  for (const cmd of result.commands) {
    if (cmd.startsWith('#')) {
      lines.push('  ' + cmd);
    } else {
      lines.push('  $ ' + cmd);
    }
  }

  if (result.skipped.length > 0) {
    lines.push('');
    lines.push('⚠️  以下模块将被跳过:');
    for (const s of result.skipped) {
      lines.push('  - ' + s);
    }
  }

  lines.push('');
  lines.push('💡 确认无误后，使用 --execute 参数实际执行');

  return lines.join('\n');
}

/**
 * 比对快照与当前系统环境的差异
 */
export async function diffEnvironment(
  snapshot: EnvSnapshot,
  current?: EnvSnapshot,
): Promise<EnvDiffResult> {
  validateEnvSnapshot(snapshot);
  if (current) validateEnvSnapshot(current);
  const cur = current || (await detectEnvironment());

  // 1. Homebrew Formulae
  const snapFormulae = new Set(snapshot.brew?.formulae || []);
  const curFormulae = new Set(cur.brew?.formulae || []);
  const missingFormulae = [...snapFormulae].filter((f) => !curFormulae.has(f));
  const extraFormulae = [...curFormulae].filter((f) => !snapFormulae.has(f));

  // 2. Homebrew Casks
  const snapCasks = new Set(snapshot.brew?.casks || []);
  const curCasks = new Set(cur.brew?.casks || []);
  const missingCasks = [...snapCasks].filter((c) => !curCasks.has(c));
  const extraCasks = [...curCasks].filter((c) => !snapCasks.has(c));

  // 3. npm Global
  const snapNpmMap = new Map(
    (snapshot.npmGlobal || []).map((p) => [p.name, p.version]),
  );
  const curNpmMap = new Map(
    (cur.npmGlobal || []).map((p) => [p.name, p.version]),
  );
  const missingNpm: string[] = [];
  const extraNpm: string[] = [];
  const npmMismatch: DiffItem[] = [];

  for (const [name, snapVer] of snapNpmMap.entries()) {
    if (!curNpmMap.has(name)) {
      missingNpm.push(name);
    } else {
      const curVer = curNpmMap.get(name)!;
      if (curVer !== 'unknown' && snapVer !== 'unknown' && curVer !== snapVer) {
        npmMismatch.push({
          name,
          expectedVersion: snapVer,
          currentVersion: curVer,
        });
      }
    }
  }
  for (const name of curNpmMap.keys()) {
    if (!snapNpmMap.has(name)) {
      extraNpm.push(name);
    }
  }

  // 4. pip
  const snapPipMap = new Map(
    (snapshot.pipPackages || []).map((p) => [p.name.toLowerCase(), p.version]),
  );
  const curPipMap = new Map(
    (cur.pipPackages || []).map((p) => [p.name.toLowerCase(), p.version]),
  );
  const missingPip: string[] = [];
  const extraPip: string[] = [];
  const pipMismatch: DiffItem[] = [];

  for (const [name, snapVer] of snapPipMap.entries()) {
    if (!curPipMap.has(name)) {
      missingPip.push(name);
    } else {
      const curVer = curPipMap.get(name)!;
      if (curVer !== snapVer) {
        pipMismatch.push({
          name,
          expectedVersion: snapVer,
          currentVersion: curVer,
        });
      }
    }
  }
  for (const name of curPipMap.keys()) {
    if (!snapPipMap.has(name)) {
      extraPip.push(name);
    }
  }

  // 5. VSCode 扩展
  const snapExts = new Set(
    (snapshot.vscodeExtensions || []).map((e) => e.id.toLowerCase()),
  );
  const curExts = new Set(
    (cur.vscodeExtensions || []).map((e) => e.id.toLowerCase()),
  );
  const missingExts = [...snapExts].filter((id) => !curExts.has(id));
  const extraExts = [...curExts].filter((id) => !snapExts.has(id));

  const totalMissing =
    missingFormulae.length +
    missingCasks.length +
    missingNpm.length +
    missingPip.length +
    missingExts.length;

  const totalExtra =
    extraFormulae.length +
    extraCasks.length +
    extraNpm.length +
    extraPip.length +
    extraExts.length;

  const totalMismatch = npmMismatch.length + pipMismatch.length;

  const hasDifferences =
    totalMissing > 0 || totalExtra > 0 || totalMismatch > 0;

  return {
    hasDifferences,
    brewFormulae: { missing: missingFormulae, extra: extraFormulae },
    brewCasks: { missing: missingCasks, extra: extraCasks },
    npmGlobal: {
      missing: missingNpm,
      extra: extraNpm,
      versionMismatch: npmMismatch,
    },
    pipPackages: {
      missing: missingPip,
      extra: extraPip,
      versionMismatch: pipMismatch,
    },
    vscodeExtensions: { missing: missingExts, extra: extraExts },
    summary: {
      totalMissing,
      totalExtra,
      totalMismatch,
    },
  };
}

/**
 * 格式化环境 Diff 输出
 */
export function formatDiffPreview(diff: EnvDiffResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('📊 环境差异比对结果:');
  lines.push('─'.repeat(60));

  if (!diff.hasDifferences) {
    lines.push('  ✨ 当前环境与快照完全一致！');
    lines.push('');
    return lines.join('\n');
  }

  if (diff.brewFormulae.missing.length > 0) {
    lines.push(
      `  🍺 缺失 Homebrew Formulae (${diff.brewFormulae.missing.length} 个):`,
    );
    for (const f of diff.brewFormulae.missing) lines.push(`    - ${f}`);
  }
  if (diff.brewCasks.missing.length > 0) {
    lines.push(
      `  🍷 缺失 Homebrew Casks (${diff.brewCasks.missing.length} 个):`,
    );
    for (const c of diff.brewCasks.missing) lines.push(`    - ${c}`);
  }
  if (diff.npmGlobal.missing.length > 0) {
    lines.push(`  📦 缺失 npm 全局包 (${diff.npmGlobal.missing.length} 个):`);
    for (const n of diff.npmGlobal.missing) lines.push(`    - ${n}`);
  }
  if (diff.pipPackages.missing.length > 0) {
    lines.push(`  🐍 缺失 pip 包 (${diff.pipPackages.missing.length} 个):`);
    for (const p of diff.pipPackages.missing) lines.push(`    - ${p}`);
  }
  if (diff.vscodeExtensions.missing.length > 0) {
    lines.push(
      `  🖥️  缺失 VSCode 扩展 (${diff.vscodeExtensions.missing.length} 个):`,
    );
    for (const e of diff.vscodeExtensions.missing) lines.push(`    - ${e}`);
  }

  if (
    diff.npmGlobal.versionMismatch.length > 0 ||
    diff.pipPackages.versionMismatch.length > 0
  ) {
    lines.push('');
    lines.push('  ⚠️  版本不一致:');
    for (const m of diff.npmGlobal.versionMismatch) {
      lines.push(
        `    - npm:${m.name} (快照: ${m.expectedVersion}, 当前: ${m.currentVersion})`,
      );
    }
    for (const m of diff.pipPackages.versionMismatch) {
      lines.push(
        `    - pip:${m.name} (快照: ${m.expectedVersion}, 当前: ${m.currentVersion})`,
      );
    }
  }

  lines.push('─'.repeat(60));
  lines.push(
    `📈 汇总: 缺失 ${diff.summary.totalMissing} 项 | 版本差异 ${diff.summary.totalMismatch} 项 | 当前多出 ${diff.summary.totalExtra} 项`,
  );
  lines.push('');

  return lines.join('\n');
}
