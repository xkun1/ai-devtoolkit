import type { EnvSnapshot } from './types.js';

const MAX_ITEMS = 10_000;
const MAX_TEXT_LENGTH = 5 * 1024 * 1024;
const SAFE_PACKAGE_TOKEN = /^[A-Za-z0-9@][A-Za-z0-9@+._/-]*$/;
const SAFE_NPM_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SAFE_PYTHON_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9.!+_~-]*$/;
const SAFE_VSCODE_ID =
  /^[A-Za-z0-9][A-Za-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateEnvSnapshot(
  value: unknown,
): asserts value is EnvSnapshot {
  const snapshot = asRecord(value, '快照');
  requireSingleLine(snapshot.version, 'version', 100);
  requireSingleLine(snapshot.exportedAt, 'exportedAt', 200);

  const system = asRecord(snapshot.system, 'system');
  for (const key of [
    'platform',
    'arch',
    'osVersion',
    'hostname',
    'username',
    'shell',
  ]) {
    requireSingleLine(system[key], `system.${key}`, 10_000);
  }

  if (snapshot.brew !== undefined) {
    const brew = asRecord(snapshot.brew, 'brew');
    validateStringArray(brew.formulae, 'brew.formulae', SAFE_PACKAGE_TOKEN);
    validateStringArray(brew.casks, 'brew.casks', SAFE_PACKAGE_TOKEN);
  }

  validateObjectArray(snapshot.npmGlobal, 'npmGlobal', (item, label) => {
    requirePattern(item.name, `${label}.name`, SAFE_NPM_NAME);
    requireText(item.version, `${label}.version`, 500);
  });
  validateObjectArray(snapshot.pipPackages, 'pipPackages', (item, label) => {
    requirePattern(item.name, `${label}.name`, SAFE_PYTHON_NAME);
    requirePattern(item.version, `${label}.version`, SAFE_VERSION);
  });
  validateObjectArray(
    snapshot.vscodeExtensions,
    'vscodeExtensions',
    (item, label) => {
      requirePattern(item.id, `${label}.id`, SAFE_VSCODE_ID);
      requireText(item.version, `${label}.version`, 500);
    },
  );

  validateObjectArray(snapshot.sdks, 'sdks', (item, label) => {
    requireText(item.name, `${label}.name`, 500);
    requireText(item.version, `${label}.version`, 500);
    if (item.path !== undefined)
      requireText(item.path, `${label}.path`, 10_000);
  });
  validateObjectArray(snapshot.macApps, 'macApps', (item, label) => {
    requireText(item.name, `${label}.name`, 1_000);
    if (typeof item.manual !== 'boolean') {
      throw new Error(`无效的快照字段 ${label}.manual`);
    }
  });

  if (snapshot.shell !== undefined) {
    const shell = asRecord(snapshot.shell, 'shell');
    requireText(shell.shell, 'shell.shell', 10_000);
    validateObjectArray(
      shell.files,
      'shell.files',
      (item, label) => {
        requirePattern(
          item.name,
          `${label}.name`,
          /^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/,
        );
        requireText(item.path, `${label}.path`, 10_000);
        requireText(item.content, `${label}.content`, MAX_TEXT_LENGTH, true);
      },
      false,
    );
  }

  if (snapshot.git !== undefined) {
    const git = asRecord(snapshot.git, 'git');
    requireText(git.config, 'git.config', MAX_TEXT_LENGTH, true);
    validateGitConfig(git.config as string);
    if (git.globalIgnore !== undefined) {
      requireText(git.globalIgnore, 'git.globalIgnore', MAX_TEXT_LENGTH, true);
    }
  }

  if (snapshot.ssh !== undefined) {
    const ssh = asRecord(snapshot.ssh, 'ssh');
    requireText(ssh.config, 'ssh.config', MAX_TEXT_LENGTH, true);
    if (ssh.knownHosts !== undefined) {
      requireText(ssh.knownHosts, 'ssh.knownHosts', MAX_TEXT_LENGTH, true);
    }
    if (typeof ssh.hasKeys !== 'boolean') {
      throw new Error('无效的快照字段 ssh.hasKeys');
    }
  }
}

function validateGitConfig(config: string): void {
  for (const [index, rawLine] of config.split(/\r?\n/).entries()) {
    if (!rawLine.trim()) continue;
    const equalsIndex = rawLine.indexOf('=');
    const key = rawLine.slice(0, equalsIndex).trim();
    if (
      equalsIndex <= 0 ||
      key.startsWith('-') ||
      key.includes('=') ||
      [...key].some((char) => char.charCodeAt(0) <= 0x20)
    ) {
      throw new Error(`无效的快照字段 git.config 第 ${index + 1} 行`);
    }
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`无效的快照字段 ${label}`);
  }
  return value as Record<string, unknown>;
}

function validateStringArray(
  value: unknown,
  label: string,
  pattern: RegExp,
): void {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new Error(`无效的快照字段 ${label}`);
  }
  value.forEach((item, index) =>
    requirePattern(item, `${label}[${index}]`, pattern),
  );
}

function validateObjectArray(
  value: unknown,
  label: string,
  validate: (item: Record<string, unknown>, label: string) => void,
  optional = true,
): void {
  if (value === undefined && optional) return;
  if (!Array.isArray(value) || value.length > MAX_ITEMS) {
    throw new Error(`无效的快照字段 ${label}`);
  }
  value.forEach((item, index) =>
    validate(asRecord(item, `${label}[${index}]`), `${label}[${index}]`),
  );
}

function requirePattern(value: unknown, label: string, pattern: RegExp): void {
  requireText(value, label, 1_000);
  if (!pattern.test(value as string) || (value as string).startsWith('-')) {
    throw new Error(`无效的快照字段 ${label}`);
  }
}

function requireText(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.length > maxLength ||
    value.includes('\0')
  ) {
    throw new Error(`无效的快照字段 ${label}`);
  }
}

function requireSingleLine(
  value: unknown,
  label: string,
  maxLength: number,
): void {
  requireText(value, label, maxLength);
  if ((value as string).includes('\n') || (value as string).includes('\r')) {
    throw new Error(`无效的快照字段 ${label}`);
  }
}
