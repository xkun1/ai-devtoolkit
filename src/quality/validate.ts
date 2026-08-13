import { basename } from 'node:path';
import type {
  AgentType,
  GeneratedArtifact,
  QualityIssue,
  QualityReport,
  SkillResult,
} from '../types/index.js';

export const QUALITY_BASELINE_VERSION = 'p1-v1';

export function validateSkillResult(result: SkillResult): QualityReport {
  const artifacts = result.artifacts ?? [
    {
      path: result.suggestedPath,
      content: result.content,
      kind: 'primary' as const,
    },
  ];
  const issues: QualityIssue[] = [];

  if (!artifacts.length) {
    issues.push(issue('error', 'NO_ARTIFACTS', '没有生成任何文件'));
  }

  for (const artifact of artifacts) {
    validateCommon(artifact, issues);
    validateAgentArtifact(result.agentType, artifact, issues);
  }

  const primary = artifacts[0];
  if (primary && primary.path !== result.suggestedPath) {
    issues.push(
      issue('error', 'PRIMARY_MISMATCH', '主文件路径与 suggestedPath 不一致'),
    );
  }

  const duplicateLineRatio = calculateDuplicateLineRatio(artifacts);
  if (duplicateLineRatio > 0.35) {
    issues.push(
      issue(
        'warning',
        'HIGH_DUPLICATION',
        `重复内容偏高（${Math.round(duplicateLineRatio * 100)}%）`,
      ),
    );
  }

  const errors = issues.filter((item) => item.severity === 'error').length;
  const warnings = issues.length - errors;
  return {
    score: Math.max(0, 100 - errors * 25 - warnings * 5),
    passed: errors === 0,
    issues,
    metrics: {
      artifactCount: artifacts.length,
      totalChars: artifacts.reduce((sum, item) => sum + item.content.length, 0),
      primaryLines: primary ? lineCount(primary.content) : 0,
      duplicateLineRatio,
    },
  };
}

export function assertValidSkillResult(result: SkillResult): QualityReport {
  const report = validateSkillResult(result);
  if (!report.passed) {
    const messages = report.issues
      .filter((item) => item.severity === 'error')
      .map((item) => `${item.path ? `${item.path}: ` : ''}${item.message}`);
    throw new Error(`生成结果校验失败：${messages.join('；')}`);
  }
  return report;
}

function validateCommon(
  artifact: GeneratedArtifact,
  issues: QualityIssue[],
): void {
  if (!artifact.content.trim()) {
    issues.push(
      issue('error', 'EMPTY_ARTIFACT', '文件内容为空', artifact.path),
    );
    return;
  }
  if (!artifact.content.endsWith('\n')) {
    issues.push(
      issue(
        'warning',
        'MISSING_FINAL_NEWLINE',
        '文件末尾缺少换行',
        artifact.path,
      ),
    );
  }
  if (/^```(?:markdown|md)?\s*\n[\s\S]*\n```\s*$/i.test(artifact.content)) {
    issues.push(
      issue(
        'error',
        'WRAPPED_MARKDOWN',
        '整个生成物被 Markdown 代码围栏包裹',
        artifact.path,
      ),
    );
  }
  if (artifact.content.includes('\u0000')) {
    issues.push(issue('error', 'NUL_BYTE', '文件包含 NUL 字节', artifact.path));
  }
  if (hasUnclosedFence(artifact.content)) {
    issues.push(
      issue(
        'error',
        'UNCLOSED_FENCE',
        'Markdown 代码围栏未闭合，生成内容可能被截断',
        artifact.path,
      ),
    );
  }
}

function validateAgentArtifact(
  agentType: AgentType,
  artifact: GeneratedArtifact,
  issues: QualityIssue[],
): void {
  if (agentType === 'codex' && basename(artifact.path) === 'SKILL.md') {
    const metadata = readFrontmatter(artifact.content);
    const name = metadata?.name;
    const description = metadata?.description;
    if (!metadata) {
      issues.push(
        issue(
          'error',
          'CODEX_FRONTMATTER',
          'SKILL.md 缺少 YAML frontmatter',
          artifact.path,
        ),
      );
    } else {
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
        issues.push(
          issue(
            'error',
            'CODEX_NAME',
            'Codex skill name 不合法',
            artifact.path,
          ),
        );
      }
      if (!description?.trim()) {
        issues.push(
          issue(
            'error',
            'CODEX_DESCRIPTION',
            'Codex skill 缺少 description',
            artifact.path,
          ),
        );
      }
    }
  }

  if (agentType === 'cursor' && artifact.path.endsWith('.mdc')) {
    const metadata = readFrontmatter(artifact.content);
    for (const key of ['description', 'globs', 'alwaysApply']) {
      if (!metadata || !(key in metadata)) {
        issues.push(
          issue(
            'error',
            'CURSOR_METADATA',
            `Cursor MDC 缺少 ${key}`,
            artifact.path,
          ),
        );
      }
    }
  }

  if (
    agentType === 'claude' &&
    basename(artifact.path) === 'CLAUDE.md' &&
    lineCount(artifact.content) > 200
  ) {
    issues.push(
      issue(
        'error',
        'CLAUDE_TOO_LONG',
        'CLAUDE.md 超过 200 行，应拆分到 .claude/rules/',
        artifact.path,
      ),
    );
  }
}

function readFrontmatter(content: string): Record<string, string> | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return undefined;
  const data: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    data[key] = value;
  }
  return data;
}

function calculateDuplicateLineRatio(artifacts: GeneratedArtifact[]): number {
  const lines = artifacts
    .flatMap((item) => item.content.split(/\r?\n/))
    .map((line) => line.trim())
    .filter((line) => line.length >= 20 && !/^[-#`]/.test(line));
  if (lines.length < 5) return 0;
  return (lines.length - new Set(lines).size) / lines.length;
}

function hasUnclosedFence(content: string): boolean {
  const fences = content.match(/^ {0,3}(`{3,}|~{3,})[^\n]*$/gm) ?? [];
  let open: { char: string; length: number } | undefined;
  for (const line of fences) {
    const token = line.trimStart().match(/^(`{3,}|~{3,})/)?.[1];
    if (!token) continue;
    if (!open) {
      open = { char: token[0], length: token.length };
    } else if (token[0] === open.char && token.length >= open.length) {
      open = undefined;
    }
  }
  return open !== undefined;
}

function lineCount(content: string): number {
  return content.length ? content.split(/\r?\n/).length : 0;
}

function issue(
  severity: QualityIssue['severity'],
  code: string,
  message: string,
  path?: string,
): QualityIssue {
  return { severity, code, message, path };
}
