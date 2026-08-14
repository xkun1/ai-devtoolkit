/**
 * 环境迁移功能类型定义
 */

/** Homebrew 包列表 */
export interface BrewPackages {
  formulae: string[];
  casks: string[];
}

/** SDK / 运行时信息 */
export interface SdkInfo {
  name: string;
  version: string;
  path?: string;
}

/** npm 全局包 */
export interface NpmGlobalPackage {
  name: string;
  version: string;
}

/** pip 全局包 */
export interface PipPackage {
  name: string;
  version: string;
}

/** VSCode 扩展 */
export interface VscodeExtension {
  id: string;
  version: string;
}

/** macOS 应用程序 */
export interface MacApp {
  name: string;
  /** 从 dmg/手动安装（无法通过命令行重装） */
  manual: boolean;
}

/** Shell 配置文件 */
export interface ShellConfig {
  shell: string;
  files: { name: string; path: string; content: string }[];
}

/** Git 全局配置 */
export interface GitConfig {
  config: string;
  /** ~/.gitignore_global 内容 */
  globalIgnore?: string;
}

/** SSH 配置 */
export interface SshConfig {
  config: string;
  knownHosts?: string;
  /** 标记：私钥不自动迁移（安全考虑） */
  hasKeys: boolean;
}

/** 完整环境快照 */
export interface EnvSnapshot {
  /** 快照版本 */
  version: string;
  /** 导出时间 */
  exportedAt: string;
  /** 系统信息 */
  system: {
    platform: string;
    arch: string;
    osVersion: string;
    hostname: string;
    username: string;
    shell: string;
  };
  /** Homebrew */
  brew?: BrewPackages;
  /** npm 全局包 */
  npmGlobal?: NpmGlobalPackage[];
  /** pip 全局包 */
  pipPackages?: PipPackage[];
  /** SDK / 运行时 */
  sdks?: SdkInfo[];
  /** VSCode 扩展 */
  vscodeExtensions?: VscodeExtension[];
  /** macOS 应用 */
  macApps?: MacApp[];
  /** Shell 配置 */
  shell?: ShellConfig;
  /** Git 配置 */
  git?: GitConfig;
  /** SSH 配置 */
  ssh?: SshConfig;
}

/** 探测选项 */
export interface DetectOptions {
  /** 自定义 HOME 目录（默认 process.env.HOME） */
  home?: string;
  /** 要探测的模块列表，不指定则全部 */
  modules?: EnvModule[];
  /** 是否包含 macOS 应用列表 */
  includeApps?: boolean;
  /** 是否包含 Shell 配置文件内容 */
  includeShell?: boolean;
  /** 是否包含 Git 配置 */
  includeGit?: boolean;
  /** 是否包含 SSH 配置（仅 config，不含私钥） */
  includeSsh?: boolean;
}

/** 环境模块标识 */
export type EnvModule =
  'brew' | 'npm' | 'pip' | 'sdks' | 'vscode' | 'apps' | 'shell' | 'git' | 'ssh';

/** 导出选项 */
export interface ExportOptions extends DetectOptions {
  /** 输出目录（默认 cwd） */
  outputDir?: string;
  /** 输出文件名前缀（默认 devtoolkit-env） */
  outputPrefix?: string;
  /** 是否生成 setup.sh 安装脚本（默认 true） */
  generateScript?: boolean;
  /** 是否生成 JSON 明细（默认 true） */
  generateJson?: boolean;
}

/** 导出结果 */
export interface ExportResult {
  snapshot: EnvSnapshot;
  /** 生成的文件路径列表 */
  files: string[];
  /** 安装脚本路径（如果生成了） */
  scriptPath?: string;
  /** JSON 明细路径（如果生成了） */
  jsonPath?: string;
  /** 统计摘要 */
  summary: {
    totalItems: number;
    details: Record<string, number>;
  };
}

/** 导入选项 */
export interface ImportOptions {
  /** 是否实际执行安装命令（默认 false = dry-run） */
  execute?: boolean;
  /** 要恢复的模块列表，不指定则全部 */
  modules?: EnvModule[];
  /** Homebrew 超时（毫秒，默认 300000 = 5 分钟） */
  brewTimeout?: number;
}

/** 导入结果 */
export interface ImportResult {
  /** dry-run 模式：打印将要执行的命令 */
  commands: string[];
  /** 实际执行结果 */
  results: { command: string; success: boolean; output: string }[];
  /** 跳过的模块 */
  skipped: string[];
}

/** 环境差异比对项 */
export interface DiffItem {
  name: string;
  expectedVersion?: string;
  currentVersion?: string;
}

/** 环境差异比对结果 */
export interface EnvDiffResult {
  hasDifferences: boolean;
  brewFormulae: { missing: string[]; extra: string[] };
  brewCasks: { missing: string[]; extra: string[] };
  npmGlobal: {
    missing: string[];
    extra: string[];
    versionMismatch: DiffItem[];
  };
  pipPackages: {
    missing: string[];
    extra: string[];
    versionMismatch: DiffItem[];
  };
  vscodeExtensions: { missing: string[]; extra: string[] };
  summary: {
    totalMissing: number;
    totalExtra: number;
    totalMismatch: number;
  };
}
