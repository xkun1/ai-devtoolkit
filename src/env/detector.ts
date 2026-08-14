/**
 * 环境探测器
 *
 * 自动扫描当前 macOS 开发环境中的各种配置和包管理器状态。
 * 所有探测方法都是独立的、幂等的、不会修改系统状态。
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname, platform, arch, release, userInfo } from 'node:os';
import type {
  BrewPackages,
  DetectOptions,
  EnvModule,
  EnvSnapshot,
  GitConfig,
  MacApp,
  NpmGlobalPackage,
  PipPackage,
  ShellConfig,
  SdkInfo,
  SshConfig,
  VscodeExtension,
} from './types.js';

/** 安全执行命令，失败返回空字符串 */
function exec(cmd: string, timeoutMs = 15000): string {
  try {
    return execSync(cmd, {
      encoding: 'utf-8',
      timeout: timeoutMs,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/** 检查命令是否存在 */
function has(cmd: string): boolean {
  return exec(`command -v ${cmd} 2>/dev/null`) !== '';
}

/** 安全读取文件 */
function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

/** 过滤敏感凭证（如 token/secret/password/apikey） */
export function maskSensitive(text: string): string {
  return text.replace(
    /((?:token|secret|password|passwd|key|auth|credential|api[_-]?key)\s*[:=]\s*)(['"]?)([^\s'"\n]{6,})\2/gi,
    '$1$2***MASKED***$2',
  );
}

// ── 各模块探测器 ──

/** 探测 Homebrew 包 */
export function detectBrew(): BrewPackages | undefined {
  if (!has('brew')) return undefined;

  const formulae = exec('brew list --formula -1 2>/dev/null')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  const casks = exec('brew list --cask -1 2>/dev/null')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  return { formulae, casks };
}

/** 探测 npm 全局包 */
export function detectNpmGlobal(): NpmGlobalPackage[] | undefined {
  if (!has('npm')) return undefined;

  const output = exec('npm ls -g --depth=0 --json 2>/dev/null');
  if (!output) return [];

  try {
    const data = JSON.parse(output);
    const deps = data.dependencies || {};
    return Object.entries(deps).map(([name, info]: [string, any]) => ({
      name,
      version: info.version || 'unknown',
    }));
  } catch {
    // 降级到文本解析
    const text = exec('npm ls -g --depth=0 2>/dev/null');
    return text
      .split('\n')
      .filter((l) => l.includes('──'))
      .map((l) => {
        const m = l.match(/(\S+)@(\S+)/);
        return m ? { name: m[1].replace(/.*\s/, ''), version: m[2] } : null;
      })
      .filter(Boolean) as NpmGlobalPackage[];
  }
}

/** 探测 pip 全局包 */
export function detectPip(): PipPackage[] | undefined {
  if (!has('pip3') && !has('pip')) return undefined;
  const pipCmd = has('pip3') ? 'pip3' : 'pip';

  const output = exec(pipCmd + ' list --format=freeze 2>/dev/null');
  if (!output) return [];

  return output
    .split('\n')
    .map((l) => {
      const m = l.match(/^([^=]+)==(.+)$/);
      return m ? { name: m[1], version: m[2] } : null;
    })
    .filter(Boolean) as PipPackage[];
}

/** 探测 SDK / 运行时 */
export function detectSdks(): SdkInfo[] {
  const sdks: SdkInfo[] = [];

  // Node.js
  const nodeVer = exec('node --version 2>/dev/null');
  if (nodeVer) sdks.push({ name: 'node', version: nodeVer });

  // Java
  const javaVer = exec('java -version 2>&1 2>/dev/null | head -1');
  if (javaVer) {
    const m = javaVer.match(/version\s+"([^"]+)"/);
    if (m) sdks.push({ name: 'java', version: m[1] });
  }

  // jenv 管理的 JDK 版本
  const jenvDir = join(homedir(), '.jenv', 'versions');
  if (existsSync(jenvDir)) {
    try {
      const versions = readdirSync(jenvDir).filter((v) => !v.startsWith('.'));
      for (const v of versions) {
        if (!v.includes('.')) continue; // 跳过别名
        sdks.push({
          name: 'jdk',
          version: v,
          path: join(jenvDir, v),
        });
      }
    } catch {
      // ignore
    }
  }

  // Go
  const goVer = exec('go version 2>/dev/null');
  if (goVer) {
    const m = goVer.match(/go(\S+)/);
    if (m) sdks.push({ name: 'go', version: m[1] });
  }

  // Rust
  const rustVer = exec('rustc --version 2>/dev/null');
  if (rustVer) {
    const m = rustVer.match(/rustc\s+(\S+)/);
    if (m) sdks.push({ name: 'rust', version: m[1] });
  }

  // Flutter
  const flutterVer = exec('flutter --version 2>/dev/null | head -1');
  if (flutterVer) {
    const m = flutterVer.match(/Flutter\s+(\S+)/);
    if (m) sdks.push({ name: 'flutter', version: m[1] });
  }

  // Python
  const pyVer = exec('python3 --version 2>/dev/null');
  if (pyVer) {
    const m = pyVer.match(/Python\s+(\S+)/);
    if (m) sdks.push({ name: 'python', version: m[1] });
  }

  // Docker
  const dockerVer = exec('docker --version 2>/dev/null');
  if (dockerVer) {
    const m = dockerVer.match(/Docker\s+version\s+(\S+)/);
    if (m) sdks.push({ name: 'docker', version: m[1] });
  }

  return sdks;
}

/** 探测 VSCode 扩展 */
export function detectVscodeExtensions(): VscodeExtension[] | undefined {
  // 方式一：通过 code CLI
  if (has('code')) {
    const output = exec('code --list-extensions --show-versions 2>/dev/null');
    if (output) {
      return output
        .split('\n')
        .map((l) => {
          const m = l.trim().match(/^(\S+)@(\S+)$/);
          return m ? { id: m[1], version: m[2] } : null;
        })
        .filter(Boolean) as VscodeExtension[];
    }
  }

  // 方式二：扫描扩展目录
  const extDir = join(homedir(), '.vscode', 'extensions');
  if (existsSync(extDir)) {
    try {
      return readdirSync(extDir)
        .filter((d) => d.includes('-') && !d.endsWith('.json'))
        .map((d) => {
          // 格式: publisher.name-version
          const m = d.match(/^(.+)-(\d[^-]*)$/);
          if (!m) return null;
          return { id: m[1], version: m[2] };
        })
        .filter(Boolean) as VscodeExtension[];
    } catch {
      // ignore
    }
  }

  return undefined;
}

/** 探测 macOS 应用程序 */
export function detectMacApps(): MacApp[] | undefined {
  if (platform() !== 'darwin') return undefined;
  if (!existsSync('/Applications')) return undefined;

  const apps = exec('ls /Applications/ 2>/dev/null')
    .split('\n')
    .map((s) => s.trim().replace(/\.app$/, ''))
    .filter(Boolean)
    .filter((a) => !['Utilities'].includes(a));

  // 判断哪些是 Homebrew Cask 安装的（可以通过命令行重装）
  const caskList = new Set(
    exec('brew list --cask -1 2>/dev/null')
      .split('\n')
      .map((s) =>
        s
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, '-'),
      ),
  );

  return apps.map((name) => ({
    name,
    manual: !caskList.has(name.toLowerCase().replace(/[^a-z0-9-]/g, '-')),
  }));
}

/** 探测 Shell 配置 */
export function detectShell(home: string = homedir()): ShellConfig | undefined {
  const shell = process.env.SHELL || exec('echo $SHELL') || '/bin/zsh';

  const configFiles = shell.includes('zsh')
    ? ['.zshrc', '.zprofile', '.zshenv']
    : shell.includes('bash')
      ? ['.bashrc', '.bash_profile', '.profile']
      : ['.profile'];

  const files: { name: string; path: string; content: string }[] = [];
  for (const f of configFiles) {
    const filePath = join(home, f);
    if (existsSync(filePath)) {
      files.push({
        name: f,
        path: filePath,
        content: maskSensitive(readFileSafe(filePath)),
      });
    }
  }

  return files.length > 0 ? { shell, files } : undefined;
}

/** 探测 Git 全局配置 */
export function detectGit(home: string = homedir()): GitConfig | undefined {
  if (!has('git')) return undefined;

  const rawConfig = exec('git config --global --list 2>/dev/null');
  if (!rawConfig) return undefined;

  const result: GitConfig = { config: maskSensitive(rawConfig) };

  // 全局 gitignore
  const ignoreFile = join(home, '.gitignore_global');
  if (existsSync(ignoreFile)) {
    result.globalIgnore = maskSensitive(readFileSafe(ignoreFile));
  }

  return result;
}

/** 探测 SSH 配置 */
export function detectSsh(home: string = homedir()): SshConfig | undefined {
  const sshDir = join(home, '.ssh');
  if (!existsSync(sshDir)) return undefined;

  const configPath = join(sshDir, 'config');
  const config = existsSync(configPath) ? readFileSafe(configPath) : '';

  const knownHostsPath = join(sshDir, 'known_hosts');
  const knownHosts = existsSync(knownHostsPath)
    ? readFileSafe(knownHostsPath)
    : undefined;

  // 检测是否有私钥（不读取内容，只标记存在）
  let hasKeys = false;
  try {
    const sshFiles = readdirSync(sshDir);
    hasKeys = sshFiles.some(
      (f) =>
        !f.endsWith('.pub') &&
        ![
          'config',
          'known_hosts',
          'known_hosts.old',
          'authorized_keys',
        ].includes(f),
    );
  } catch {
    // ignore
  }

  return { config, knownHosts, hasKeys };
}

// ── 统一入口 ──

/** 完整环境探测 */
export async function detectEnvironment(
  options: DetectOptions = {},
): Promise<EnvSnapshot> {
  const home = options.home || homedir();
  const enabledModules = options.modules;

  const isEnabled = (mod: EnvModule): boolean =>
    !enabledModules || enabledModules.includes(mod);

  const snapshot: EnvSnapshot = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    system: {
      platform: platform(),
      arch: arch(),
      osVersion: release(),
      hostname: hostname(),
      username: userInfo().username,
      shell: process.env.SHELL || '/bin/sh',
    },
  };

  // Homebrew
  if (isEnabled('brew')) {
    const brew = detectBrew();
    if (brew) snapshot.brew = brew;
  }

  // npm
  if (isEnabled('npm')) {
    const npm = detectNpmGlobal();
    if (npm) snapshot.npmGlobal = npm;
  }

  // pip
  if (isEnabled('pip')) {
    const pip = detectPip();
    if (pip) snapshot.pipPackages = pip;
  }

  // SDK
  if (isEnabled('sdks')) {
    snapshot.sdks = detectSdks();
  }

  // VSCode
  if (isEnabled('vscode')) {
    const vscode = detectVscodeExtensions();
    if (vscode) snapshot.vscodeExtensions = vscode;
  }

  // macOS Apps
  if (isEnabled('apps') && options.includeApps !== false) {
    const apps = detectMacApps();
    if (apps) snapshot.macApps = apps;
  }

  // Shell
  if (isEnabled('shell') && options.includeShell !== false) {
    const shell = detectShell(home);
    if (shell) snapshot.shell = shell;
  }

  // Git
  if (isEnabled('git') && options.includeGit !== false) {
    const git = detectGit(home);
    if (git) snapshot.git = git;
  }

  // SSH
  if (isEnabled('ssh') && options.includeSsh !== false) {
    const ssh = detectSsh(home);
    if (ssh) snapshot.ssh = ssh;
  }

  return snapshot;
}
