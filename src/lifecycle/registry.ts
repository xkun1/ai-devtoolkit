/**
 * 技能包注册表管理器
 *
 * 跟踪项目中所有已生成的技能包，支持 list / status / remove / rollback。
 */
import { readFile, access, unlink, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { InstalledSkill, SkillRegistry, SkillStatus } from './types.js';
import { writeFileAtomic } from '../utils/atomic-write.js';

export const REGISTRY_VERSION = '1.0.0';
export const REGISTRY_FILENAME = '.devtoolkit-skills.json';

/** 加载注册表（不存在时返回空注册表） */
export async function loadRegistry(
  projectRoot: string = process.cwd(),
): Promise<SkillRegistry> {
  const path = join(projectRoot, REGISTRY_FILENAME);
  try {
    await access(path);
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as SkillRegistry;
    if (parsed.version === REGISTRY_VERSION && parsed.skills) {
      return parsed;
    }
  } catch {
    // 不存在或格式错误
  }
  return { version: REGISTRY_VERSION, projectRoot, skills: {} };
}

/** 保存注册表 */
export async function saveRegistry(registry: SkillRegistry): Promise<string> {
  const path = join(registry.projectRoot, REGISTRY_FILENAME);
  await ensureRegistryIgnored(registry.projectRoot);
  await writeFileAtomic(path, JSON.stringify(registry, null, 2));
  return path;
}

/** 注册一个新技能包 */
export function registerSkill(
  registry: SkillRegistry,
  skill: Omit<InstalledSkill, 'version'>,
): void {
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
    const exists = existsSync(join(projectRoot, skill.primaryPath));
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

  // 删除主文件
  const primaryAbs = join(projectRoot, skill.primaryPath);
  if (existsSync(primaryAbs)) {
    await unlink(primaryAbs).catch(() => undefined);
  }

  // 如果是 Codex 技能目录，删除整个目录
  if (skill.primaryPath.includes('.agents/skills/')) {
    const skillDir = dirname(primaryAbs);
    if (existsSync(skillDir)) {
      await rm(skillDir, { recursive: true }).catch(() => undefined);
    }
  }

  // 删除其他产物
  for (const artifactPath of skill.artifactPaths) {
    if (artifactPath === skill.primaryPath) continue;
    const abs = join(projectRoot, artifactPath);
    if (existsSync(abs)) {
      await unlink(abs).catch(() => undefined);
    }
  }

  delete registry.skills[name];
  await saveRegistry(registry);
  return true;
}

async function ensureRegistryIgnored(dir: string): Promise<void> {
  const ignorePath = join(dir, '.gitignore');
  let content = '';
  try {
    content = await readFile(ignorePath, 'utf-8');
  } catch {
    // ENOENT
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
