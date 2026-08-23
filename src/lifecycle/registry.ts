/**
 * 技能包注册表管理器
 *
 * 跟踪项目中所有已生成的技能包，支持 list / status / remove。
 */
import { readFile, unlink, lstat, realpath, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { existsSync } from 'node:fs';
import type { InstalledSkill, SkillRegistry, SkillStatus } from './types.js';
import { writeFileAtomic } from '../utils/atomic-write.js';

export const REGISTRY_VERSION = '1.0.0';
export const REGISTRY_FILENAME = '.devtoolkit-skills.json';
const MAX_REGISTRY_CHARS = 10 * 1024 * 1024;
const MAX_SKILLS = 10_000;
const MAX_ARTIFACTS_PER_SKILL = 1_000;

export class RegistryValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`技能注册表无效：${message}`, options);
    this.name = 'RegistryValidationError';
  }
}

/** 加载注册表（不存在时返回空注册表） */
export async function loadRegistry(
  projectRoot: string = process.cwd(),
): Promise<SkillRegistry> {
  const safeRoot = resolve(projectRoot);
  const path = join(safeRoot, REGISTRY_FILENAME);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (error: unknown) {
    if (getErrorCode(error) === 'ENOENT') {
      return emptyRegistry(safeRoot);
    }
    throw error;
  }
  if (raw.length > MAX_REGISTRY_CHARS) {
    throw new RegistryValidationError('文件体积超过 10 MiB 限制');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new RegistryValidationError('JSON 解析失败', { cause: error });
  }
  // 兼容旧版可能写入的外部绝对路径：逐项校验并忽略不安全条目。
  return validateRegistry(parsed, safeRoot, true);
}

/** 保存注册表 */
export async function saveRegistry(registry: SkillRegistry): Promise<string> {
  const safeRoot = resolve(registry.projectRoot);
  const validated = validateRegistry(registry, safeRoot);
  const path = join(safeRoot, REGISTRY_FILENAME);
  await ensureRegistryIgnored(safeRoot);
  await writeFileAtomic(path, JSON.stringify(validated, null, 2));
  return path;
}

/** 注册一个新技能包 */
export function registerSkill(
  registry: SkillRegistry,
  skill: Omit<InstalledSkill, 'version'>,
): void {
  if (!isSafeSkillKey(skill.name)) {
    throw new RegistryValidationError(`技能名 ${skill.name} 无效`);
  }
  const existing = registry.skills[skill.name];
  registry.skills[skill.name] = {
    ...skill,
    version: (existing?.version ?? 0) + 1,
  };
}

/** 列出所有已安装技能包的状态 */
export async function listSkills(
  projectRoot: string = process.cwd(),
): Promise<SkillStatus[]> {
  const registry = await loadRegistry(projectRoot);
  const statuses: SkillStatus[] = [];

  for (const [name, skill] of Object.entries(registry.skills)) {
    const exists = existsSync(
      resolveArtifactPath(registry.projectRoot, skill.primaryPath),
    );
    statuses.push({
      name,
      agentType: skill.agentType,
      primaryPath: skill.primaryPath,
      exists,
      stale: false,
      lastGeneratedAt: skill.generatedAt,
    });
  }

  return statuses.sort((a, b) => a.name.localeCompare(b.name));
}

/** 移除技能包及其产物文件 */
export async function removeSkill(
  name: string,
  projectRoot: string = process.cwd(),
): Promise<boolean> {
  const registry = await loadRegistry(projectRoot);
  const skill = registry.skills[name];
  if (!skill) return false;

  // 在删除任何文件前完成全部边界与符号链接检查，避免部分删除。
  const paths = [...new Set([skill.primaryPath, ...skill.artifactPaths])];
  const targets = paths.map((path) => ({
    absolutePath: resolveArtifactPath(registry.projectRoot, path),
  }));
  for (const target of targets) {
    await assertSafeExistingArtifact(registry.projectRoot, target.absolutePath);
  }

  for (const target of targets) {
    try {
      await unlink(target.absolutePath);
    } catch (error: unknown) {
      if (getErrorCode(error) !== 'ENOENT') throw error;
    }
  }

  await removeEmptyCodexDirectories(
    registry.projectRoot,
    skill.primaryPath,
    targets.map((target) => target.absolutePath),
  );

  delete registry.skills[name];
  await saveRegistry(registry);
  return true;
}

async function ensureRegistryIgnored(dir: string): Promise<void> {
  const ignorePath = join(dir, '.gitignore');
  let content = '';
  try {
    content = await readFile(ignorePath, 'utf-8');
  } catch (error: unknown) {
    if (getErrorCode(error) !== 'ENOENT') throw error;
  }
  const entries = new Set(
    content
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );
  if (entries.has(REGISTRY_FILENAME) || entries.has('/' + REGISTRY_FILENAME)) {
    return;
  }
  const sep = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await writeFileAtomic(ignorePath, `${content}${sep}${REGISTRY_FILENAME}\n`);
}

function emptyRegistry(projectRoot: string): SkillRegistry {
  return { version: REGISTRY_VERSION, projectRoot, skills: {} };
}

function validateRegistry(
  value: unknown,
  projectRoot: string,
  skipInvalidSkills = false,
): SkillRegistry {
  if (!isRecord(value)) {
    throw new RegistryValidationError('根节点必须是对象');
  }
  if (value.version !== REGISTRY_VERSION) {
    throw new RegistryValidationError(`不支持的版本 ${String(value.version)}`);
  }
  if (!isRecord(value.skills)) {
    throw new RegistryValidationError('skills 必须是对象');
  }
  if (Object.keys(value.skills).length > MAX_SKILLS) {
    throw new RegistryValidationError(`skills 不能超过 ${MAX_SKILLS} 项`);
  }

  const skills: Record<string, InstalledSkill> = {};
  for (const [key, rawSkill] of Object.entries(value.skills)) {
    try {
      const skill = validateSkill(key, rawSkill, projectRoot);
      skills[key] = skill;
    } catch (error: unknown) {
      if (
        skipInvalidSkills &&
        error instanceof RegistryValidationError &&
        hasLegacyAbsoluteArtifactPath(rawSkill)
      ) {
        continue;
      }
      throw error;
    }
  }

  // 永远使用调用方指定的项目根目录，不信任磁盘中可篡改的 projectRoot。
  return { version: REGISTRY_VERSION, projectRoot, skills };
}

function hasLegacyAbsoluteArtifactPath(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const paths = [
    value.primaryPath,
    ...(Array.isArray(value.artifactPaths) ? value.artifactPaths : []),
  ];
  return paths.some((path) => typeof path === 'string' && isAbsolute(path));
}

function validateSkill(
  key: string,
  value: unknown,
  projectRoot: string,
): InstalledSkill {
  if (!isRecord(value)) {
    throw new RegistryValidationError(`技能 ${key} 必须是对象`);
  }
  if (!isSafeSkillKey(key) || value.name !== key) {
    throw new RegistryValidationError(`技能名 ${key} 无效或与键不一致`);
  }
  if (!isSafeText(value.agentType, 100)) {
    throw new RegistryValidationError(`技能 ${key} 的 agentType 无效`);
  }
  if (!isSafeText(value.primaryPath, 4_096)) {
    throw new RegistryValidationError(`技能 ${key} 的 primaryPath 无效`);
  }
  resolveArtifactPath(projectRoot, value.primaryPath);
  if (
    !Array.isArray(value.artifactPaths) ||
    value.artifactPaths.length > MAX_ARTIFACTS_PER_SKILL ||
    !value.artifactPaths.every((path) => isSafeText(path, 4_096))
  ) {
    throw new RegistryValidationError(`技能 ${key} 的 artifactPaths 无效`);
  }
  for (const path of value.artifactPaths) {
    resolveArtifactPath(projectRoot, path);
  }
  if (
    typeof value.sourceFingerprint !== 'string' ||
    value.sourceFingerprint.length > 1_024
  ) {
    throw new RegistryValidationError(`技能 ${key} 的 sourceFingerprint 无效`);
  }
  if (
    typeof value.generatedAt !== 'number' ||
    !Number.isFinite(value.generatedAt) ||
    value.generatedAt < 0
  ) {
    throw new RegistryValidationError(`技能 ${key} 的 generatedAt 无效`);
  }
  if (
    typeof value.version !== 'number' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1
  ) {
    throw new RegistryValidationError(`技能 ${key} 的 version 无效`);
  }

  return {
    name: key,
    agentType: value.agentType,
    primaryPath: value.primaryPath,
    artifactPaths: [...new Set(value.artifactPaths)],
    sourceFingerprint: value.sourceFingerprint,
    generatedAt: value.generatedAt,
    version: value.version,
  };
}

function resolveArtifactPath(
  projectRoot: string,
  artifactPath: string,
): string {
  if (isAbsolute(artifactPath) || artifactPath.includes('\0')) {
    throw new RegistryValidationError(
      `产物路径必须是项目内相对路径：${artifactPath}`,
    );
  }
  if (artifactPath.split(/[\\/]+/).includes('..')) {
    throw new RegistryValidationError(
      `产物路径不能包含上级目录段：${artifactPath}`,
    );
  }
  const absolutePath = resolve(projectRoot, artifactPath);
  const rel = relative(resolve(projectRoot), absolutePath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new RegistryValidationError(`产物路径越过项目边界：${artifactPath}`);
  }
  return absolutePath;
}

async function assertSafeExistingArtifact(
  projectRoot: string,
  artifactPath: string,
): Promise<void> {
  let stat;
  try {
    stat = await lstat(artifactPath);
  } catch (error: unknown) {
    if (getErrorCode(error) === 'ENOENT') return;
    throw error;
  }
  if (stat.isDirectory()) {
    throw new RegistryValidationError(`产物路径不能是目录：${artifactPath}`);
  }
  if (stat.isSymbolicLink()) {
    throw new RegistryValidationError(`拒绝删除符号链接产物：${artifactPath}`);
  }

  const [rootRealPath, parentRealPath] = await Promise.all([
    realpath(projectRoot),
    realpath(dirname(artifactPath)),
  ]);
  const rel = relative(rootRealPath, parentRealPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new RegistryValidationError(
      `产物真实路径越过项目边界：${artifactPath}`,
    );
  }
}

async function removeEmptyCodexDirectories(
  projectRoot: string,
  primaryPath: string,
  artifactPaths: string[],
): Promise<void> {
  const parts = primaryPath.replaceAll('\\', '/').split('/');
  if (
    parts.length !== 4 ||
    parts[0] !== '.agents' ||
    parts[1] !== 'skills' ||
    parts[parts.length - 1] !== 'SKILL.md'
  ) {
    return;
  }

  const skillDir = resolve(projectRoot, parts.slice(0, 3).join('/'));
  const dirs = new Set<string>([skillDir]);
  for (const artifactPath of artifactPaths) {
    let current = dirname(artifactPath);
    while (current !== dirname(skillDir)) {
      const rel = relative(skillDir, current);
      if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) break;
      dirs.add(current);
      if (current === skillDir) break;
      current = dirname(current);
    }
  }

  const deepestFirst = [...dirs].sort(
    (a, b) => b.split(sep).length - a.split(sep).length,
  );
  for (const dir of deepestFirst) {
    try {
      await rmdir(dir);
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\0\r\n]/.test(value)
  );
}

function isSafeSkillKey(value: unknown): value is string {
  return (
    isSafeText(value, 200) &&
    value !== '__proto__' &&
    value !== 'prototype' &&
    value !== 'constructor'
  );
}

function getErrorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error.code === 'string'
    ? error.code
    : undefined;
}
