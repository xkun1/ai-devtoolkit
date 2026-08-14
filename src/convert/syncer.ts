/**
 * 项目全量规则同步器
 *
 * 自动发现项目已有的 Agent 规则，并一键同步分发到其他 Agent 平台。
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { existsSync } from 'node:fs';
import type { AgentType } from '../types/index.js';
import type {
  DiscoveredRules,
  SyncOperation,
  SyncOptions,
  SyncResult,
} from './types.js';
import { parseRule } from './parser.js';
import { convertRule } from './converter.js';
import { writeFileAtomic } from '../utils/atomic-write.js';

const ALL_AGENTS: AgentType[] = ['codex', 'cursor', 'claude'];

/** 发现项目中存在的规则定义 */
export async function discoverProjectRules(
  projectRoot: string = process.cwd(),
): Promise<DiscoveredRules[]> {
  const discovered: DiscoveredRules[] = [];

  // 1. 检查 Cursor: .cursor/rules/*.mdc
  const cursorDir = join(projectRoot, '.cursor', 'rules');
  if (existsSync(cursorDir)) {
    try {
      const entries = await readdir(cursorDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith('.mdc'))
        .map((e) => ({
          path: join(cursorDir, e.name),
          name: basename(e.name, '.mdc'),
        }));
      if (files.length > 0) {
        discovered.push({
          agentType: 'cursor',
          format: 'cursor',
          baseDir: cursorDir,
          files,
        });
      }
    } catch {
      // ignore
    }
  }

  // 2. 检查 Codex: .agents/skills/*/SKILL.md
  const codexDir = join(projectRoot, '.agents', 'skills');
  if (existsSync(codexDir)) {
    try {
      const entries = await readdir(codexDir, { withFileTypes: true });
      const files: { path: string; name: string }[] = [];
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillFile = join(codexDir, entry.name, 'SKILL.md');
          if (existsSync(skillFile)) {
            files.push({
              path: skillFile,
              name: entry.name,
            });
          }
        }
      }
      if (files.length > 0) {
        discovered.push({
          agentType: 'codex',
          format: 'codex',
          baseDir: codexDir,
          files,
        });
      }
    } catch {
      // ignore
    }
  }

  // 3. 检查 Claude: CLAUDE.md 或 .claude/rules/*.md
  const claudeFile = join(projectRoot, 'CLAUDE.md');
  const claudeRulesDir = join(projectRoot, '.claude', 'rules');
  const claudeFiles: { path: string; name: string }[] = [];

  if (existsSync(claudeFile)) {
    claudeFiles.push({ path: claudeFile, name: 'CLAUDE' });
  }
  if (existsSync(claudeRulesDir)) {
    try {
      const entries = await readdir(claudeRulesDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.md')) {
          claudeFiles.push({
            path: join(claudeRulesDir, e.name),
            name: basename(e.name, '.md'),
          });
        }
      }
    } catch {
      // ignore
    }
  }

  if (claudeFiles.length > 0) {
    discovered.push({
      agentType: 'claude',
      format: 'claude',
      baseDir: projectRoot,
      files: claudeFiles,
    });
  }

  return discovered;
}

/** 同步项目全部规则到目标 Agent */
export async function syncProjectRules(
  options: SyncOptions = {},
): Promise<SyncResult> {
  const root = options.projectRoot
    ? resolve(options.projectRoot)
    : process.cwd();
  const dryRun = options.dryRun ?? false;

  const discovered = await discoverProjectRules(root);
  const operations: SyncOperation[] = [];

  if (discovered.length === 0) {
    return {
      projectRoot: root,
      discovered: [],
      operations: [],
      summary: { totalDiscovered: 0, totalSynced: 0, byAgent: {} },
    };
  }

  // 确定源 Agent 和目标 Agent
  const primarySource = discovered[0];
  let rulesToSync = primarySource;
  if (options.from && options.from !== 'auto') {
    const requestedSource = discovered.find(
      (item) => item.agentType === options.from,
    );
    if (!requestedSource) {
      throw new Error(`未发现 ${options.from} 类型的源规则`);
    }
    rulesToSync = requestedSource;
  }
  const sourceAgent = rulesToSync.agentType;
  const targetAgents = [
    ...new Set(options.to || ALL_AGENTS.filter((a) => a !== sourceAgent)),
  ];

  const byAgent: Record<string, number> = {};
  for (const t of targetAgents) byAgent[t] = 0;

  for (const file of rulesToSync.files) {
    let content: string;
    try {
      content = await readFile(file.path, 'utf-8');
    } catch {
      continue;
    }

    const parsed = parseRule(content, file.path);

    for (const targetAgent of targetAgents) {
      if (targetAgent === rulesToSync.agentType) continue;

      const converted = convertRule(parsed, {
        to: targetAgent,
        name: file.name,
        outputDir: root,
      });

      for (const art of converted.artifacts) {
        let action: 'created' | 'updated' | 'skipped' = 'created';
        if (existsSync(art.path)) {
          try {
            const existing = await readFile(art.path, 'utf-8');
            if (existing.trim() === art.content.trim()) {
              action = 'skipped';
            } else {
              action = 'updated';
            }
          } catch {
            action = 'updated';
          }
        }

        if (!dryRun && action !== 'skipped') {
          await writeFileAtomic(art.path, art.content);
        }

        if (action !== 'skipped') {
          byAgent[targetAgent] = (byAgent[targetAgent] || 0) + 1;
        }

        operations.push({
          targetAgent,
          sourceFile: file.path,
          targetPath: art.path,
          action,
          contentLength: art.content.length,
        });
      }
    }
  }

  const totalSynced = operations.filter((op) => op.action !== 'skipped').length;

  return {
    projectRoot: root,
    discovered,
    operations,
    summary: {
      totalDiscovered: rulesToSync.files.length,
      totalSynced,
      byAgent,
    },
  };
}
