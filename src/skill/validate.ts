import { lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';
import { parseDocument } from 'yaml';
import type {
  SkillValidationIssue,
  SkillValidationOptions,
  SkillValidationReport,
  SkillValidationSummary,
} from './types.js';

const MAX_SKILL_BYTES = 1024 * 1024;
const MAX_SKILL_LINES = 500;
const MAX_DISCOVERED_SKILLS = 200;
const MAX_DISCOVERY_DEPTH = 8;
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.gitnexus',
  'node_modules',
  'dist',
  'coverage',
  'test-results',
]);
const STANDARD_FRONTMATTER_KEYS = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);

/** 校验一个 Skill 目录、SKILL.md 文件，或项目中发现的全部 Skills。 */
export async function validateSkillTarget(
  target = '.',
  options: SkillValidationOptions = {},
): Promise<SkillValidationSummary> {
  const absoluteTarget = resolve(target);
  const strict = options.strict ?? false;
  let discovery: Awaited<ReturnType<typeof discoverSkillFiles>>;
  try {
    discovery = await discoverSkillFiles(absoluteTarget);
  } catch (error: unknown) {
    const code = getErrorCode(error);
    const targetIssue = issue(
      'error',
      code === 'ENOENT' ? 'TARGET_NOT_FOUND' : 'TARGET_UNREADABLE',
      code === 'ENOENT'
        ? '校验目标不存在'
        : `无法读取校验目标：${error instanceof Error ? error.message : String(error)}`,
      absoluteTarget,
    );
    return {
      target: absoluteTarget,
      strict,
      passed: false,
      reports: [],
      issues: [targetIssue],
      totals: { skills: 0, errors: 1, warnings: 0 },
    };
  }
  const skillFiles = discovery.files;
  const reports = await Promise.all(
    skillFiles.map((skillFile) =>
      validateSkillFile(skillFile, { checkLinks: options.checkLinks }),
    ),
  );
  const issues: SkillValidationIssue[] = [];
  if (skillFiles.length === 0) {
    issues.push({
      severity: 'error',
      code: 'NO_SKILLS_FOUND',
      message:
        '未发现 SKILL.md；请传入 Skill 目录、SKILL.md 或包含 Skills 的项目目录',
      path: absoluteTarget,
    });
  }
  if (discovery.truncated) {
    issues.push({
      severity: 'error',
      code: 'DISCOVERY_LIMIT',
      message: `发现的技能超过 ${MAX_DISCOVERED_SKILLS} 个，校验未完整执行`,
      path: absoluteTarget,
    });
  }

  const allIssues = [...issues, ...reports.flatMap((report) => report.issues)];
  const errors = allIssues.filter((item) => item.severity === 'error').length;
  const warnings = allIssues.length - errors;
  return {
    target: absoluteTarget,
    strict,
    passed: errors === 0 && (!strict || warnings === 0),
    reports,
    issues,
    totals: {
      skills: reports.length,
      errors,
      warnings,
    },
  };
}

/** 校验单个 SKILL.md。 */
export async function validateSkillFile(
  skillFile: string,
  options: Pick<SkillValidationOptions, 'checkLinks'> = {},
): Promise<SkillValidationReport> {
  const absoluteFile = resolve(skillFile);
  const skillDirectory = dirname(absoluteFile);
  const issues: SkillValidationIssue[] = [];
  const displayPath = display(absoluteFile);
  let bytes = 0;
  let lines = 0;
  let references = 0;
  let name: string | undefined;
  let description: string | undefined;

  if (basename(absoluteFile) !== 'SKILL.md') {
    issues.push(
      issue(
        'error',
        'INVALID_FILENAME',
        '技能主文件必须命名为 SKILL.md',
        displayPath,
      ),
    );
  }

  let entryInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    entryInfo = await lstat(absoluteFile);
  } catch (error: unknown) {
    const code = getErrorCode(error);
    issues.push(
      issue(
        'error',
        code === 'ENOENT' ? 'SKILL_NOT_FOUND' : 'SKILL_UNREADABLE',
        code === 'ENOENT'
          ? 'SKILL.md 不存在'
          : `无法读取 SKILL.md：${error instanceof Error ? error.message : String(error)}`,
        displayPath,
      ),
    );
    return report();
  }
  const fileInfo = entryInfo.isSymbolicLink()
    ? await stat(absoluteFile)
    : entryInfo;
  bytes = fileInfo.size;
  if (!fileInfo.isFile()) {
    issues.push(
      issue('error', 'NOT_A_FILE', 'SKILL.md 不是普通文件', displayPath),
    );
    return report();
  }
  if (entryInfo.isSymbolicLink()) {
    issues.push(
      issue(
        'warning',
        'SYMLINK_SKILL',
        'SKILL.md 是符号链接，请确认来源可信',
        displayPath,
      ),
    );
    const rootRealPath = await realpath(skillDirectory);
    const fileRealPath = await realpath(absoluteFile);
    if (isOutside(relative(rootRealPath, fileRealPath))) {
      issues.push(
        issue(
          'error',
          'SKILL_SYMLINK_ESCAPE',
          'SKILL.md 通过符号链接越过 Skill 根目录',
          displayPath,
        ),
      );
    }
  }
  if (bytes > MAX_SKILL_BYTES) {
    issues.push(
      issue(
        'error',
        'SKILL_TOO_LARGE',
        `SKILL.md 超过 ${MAX_SKILL_BYTES / 1024} KiB 安全上限`,
        displayPath,
      ),
    );
    return report();
  }

  const content = await readFile(absoluteFile, 'utf-8');
  lines = content.length ? content.split(/\r?\n/).length : 0;
  if (content.includes('\u0000')) {
    issues.push(
      issue('error', 'NUL_BYTE', 'SKILL.md 包含 NUL 字节', displayPath),
    );
  }

  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) {
    issues.push(
      issue(
        'error',
        'FRONTMATTER_MISSING',
        'SKILL.md 必须以 YAML frontmatter 开头',
        displayPath,
      ),
    );
  } else {
    const parsed = parseFrontmatter(frontmatter.yaml, issues, displayPath);
    if (parsed) {
      name = validateName(parsed.name, skillDirectory, issues, displayPath);
      description = validateDescription(
        parsed.description,
        issues,
        displayPath,
      );
      validateOptionalMetadata(parsed, issues, displayPath);
    }
    if (!frontmatter.body.trim()) {
      issues.push(
        issue('error', 'EMPTY_BODY', 'SKILL.md 缺少指令正文', displayPath),
      );
    }
    if (options.checkLinks !== false) {
      const targets = extractLocalTargets(frontmatter.body);
      references = targets.length;
      await validateLocalTargets(targets, skillDirectory, issues, displayPath);
    }
  }

  if (lines > MAX_SKILL_LINES) {
    issues.push(
      issue(
        'warning',
        'PROGRESSIVE_DISCLOSURE',
        `SKILL.md 共 ${lines} 行；建议控制在 ${MAX_SKILL_LINES} 行内，并将细节拆到 references/`,
        displayPath,
      ),
    );
  }

  await validateOptionalDirectories(skillDirectory, issues);
  return report();

  function report(): SkillValidationReport {
    return {
      skillDirectory,
      skillFile: absoluteFile,
      name,
      description,
      passed: !issues.some((item) => item.severity === 'error'),
      issues,
      metrics: { lines, bytes, references },
    };
  }
}

/** 将校验结果格式化为适合终端和 CI 日志的稳定文本。 */
export function formatSkillValidationSummary(
  summary: SkillValidationSummary,
): string {
  const lines = ['🔎 Agent Skill 规范校验', ''];
  for (const report of summary.reports) {
    const reportPassed =
      report.passed &&
      (!summary.strict ||
        !report.issues.some((item) => item.severity === 'warning'));
    const status = reportPassed ? '✓' : '✗';
    const label = report.name ? ` (${report.name})` : '';
    lines.push(`${status} ${display(report.skillFile)}${label}`);
    for (const item of report.issues) {
      lines.push(
        `  ${item.severity === 'error' ? '✗' : '⚠'} [${item.code}] ${item.message}`,
      );
    }
  }
  for (const item of summary.issues) {
    lines.push(
      `${item.severity === 'error' ? '✗' : '⚠'} [${item.code}] ${item.message}`,
    );
  }
  lines.push('');
  lines.push(
    `${summary.passed ? '✅ 通过' : '❌ 未通过'}：${summary.totals.skills} 个技能，${summary.totals.errors} 个错误，${summary.totals.warnings} 个警告${summary.strict ? '（严格模式）' : ''}`,
  );
  return lines.join('\n');
}

async function discoverSkillFiles(
  target: string,
): Promise<{ files: string[]; truncated: boolean }> {
  const targetInfo = await stat(target);
  if (targetInfo.isFile()) return { files: [target], truncated: false };
  if (!targetInfo.isDirectory()) return { files: [], truncated: false };

  const directSkill = resolve(target, 'SKILL.md');
  try {
    if ((await stat(directSkill)).isFile()) {
      return { files: [directSkill], truncated: false };
    }
  } catch {
    // 继续按项目目录发现。
  }

  const found: string[] = [];
  const state = { truncated: false };
  await walk(target, 0, found, state);
  return { files: [...new Set(found)].sort(), truncated: state.truncated };
}

async function walk(
  directory: string,
  depth: number,
  found: string[],
  state: { truncated: boolean },
): Promise<void> {
  if (depth > MAX_DISCOVERY_DEPTH || state.truncated) return;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (state.truncated) return;
    const path = resolve(directory, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') {
      if (found.length >= MAX_DISCOVERED_SKILLS) {
        state.truncated = true;
        return;
      }
      found.push(path);
    } else if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
      await walk(path, depth + 1, found, state);
    }
  }
}

function extractFrontmatter(
  content: string,
): { yaml: string; body: string } | undefined {
  const normalized = content.replace(/\r\n?/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  return match ? { yaml: match[1], body: match[2] } : undefined;
}

function parseFrontmatter(
  yaml: string,
  issues: SkillValidationIssue[],
  path: string,
): Record<string, unknown> | undefined {
  const document = parseDocument(yaml, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    for (const error of document.errors) {
      issues.push(issue('error', 'YAML_INVALID', error.message, path));
    }
    return undefined;
  }
  let value: unknown;
  try {
    value = document.toJS({ maxAliasCount: 20 });
  } catch (error: unknown) {
    issues.push(
      issue(
        'error',
        'YAML_INVALID',
        error instanceof Error ? error.message : String(error),
        path,
      ),
    );
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push(
      issue('error', 'FRONTMATTER_TYPE', 'frontmatter 必须是键值映射', path),
    );
    return undefined;
  }
  return value;
}

function validateName(
  value: unknown,
  skillDirectory: string,
  issues: SkillValidationIssue[],
  path: string,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    issues.push(issue('error', 'NAME_REQUIRED', 'name 必须是非空字符串', path));
    return undefined;
  }
  if (value.length > 64) {
    issues.push(issue('error', 'NAME_LENGTH', 'name 不能超过 64 个字符', path));
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    issues.push(
      issue(
        'error',
        'NAME_FORMAT',
        'name 只能包含小写字母、数字和单连字符，且不能以连字符开头或结尾',
        path,
      ),
    );
  }
  const parentName = basename(skillDirectory);
  if (value !== parentName) {
    issues.push(
      issue(
        'error',
        'NAME_DIRECTORY_MISMATCH',
        `name "${value}" 必须与父目录 "${parentName}" 一致`,
        path,
      ),
    );
  }
  return value;
}

function validateDescription(
  value: unknown,
  issues: SkillValidationIssue[],
  path: string,
): string | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(
      issue(
        'error',
        'DESCRIPTION_REQUIRED',
        'description 必须是非空字符串',
        path,
      ),
    );
    return undefined;
  }
  if (value.length > 1024) {
    issues.push(
      issue(
        'error',
        'DESCRIPTION_LENGTH',
        'description 不能超过 1024 个字符',
        path,
      ),
    );
  }
  if (value.trim().length < 12) {
    issues.push(
      issue(
        'warning',
        'DESCRIPTION_TOO_GENERIC',
        'description 过短，建议同时说明技能用途和触发场景',
        path,
      ),
    );
  }
  return value;
}

function validateOptionalMetadata(
  data: Record<string, unknown>,
  issues: SkillValidationIssue[],
  path: string,
): void {
  for (const key of Object.keys(data)) {
    if (!STANDARD_FRONTMATTER_KEYS.has(key)) {
      issues.push(
        issue(
          'warning',
          'UNKNOWN_FRONTMATTER_KEY',
          `未识别的 frontmatter 字段: ${key}`,
          path,
        ),
      );
    }
  }

  if ('license' in data && !isNonEmptyString(data.license)) {
    issues.push(
      issue('error', 'LICENSE_TYPE', 'license 必须是非空字符串', path),
    );
  }
  if ('compatibility' in data) {
    if (!isNonEmptyString(data.compatibility)) {
      issues.push(
        issue(
          'error',
          'COMPATIBILITY_TYPE',
          'compatibility 必须是非空字符串',
          path,
        ),
      );
    } else if (data.compatibility.length > 500) {
      issues.push(
        issue(
          'error',
          'COMPATIBILITY_LENGTH',
          'compatibility 不能超过 500 个字符',
          path,
        ),
      );
    }
  }
  if ('allowed-tools' in data && !isNonEmptyString(data['allowed-tools'])) {
    issues.push(
      issue(
        'error',
        'ALLOWED_TOOLS_TYPE',
        'allowed-tools 必须是非空字符串',
        path,
      ),
    );
  }
  if ('metadata' in data) {
    if (!isRecord(data.metadata)) {
      issues.push(
        issue('error', 'METADATA_TYPE', 'metadata 必须是字符串键值映射', path),
      );
    } else {
      for (const [key, value] of Object.entries(data.metadata)) {
        if (typeof value !== 'string') {
          issues.push(
            issue(
              'error',
              'METADATA_VALUE_TYPE',
              `metadata.${key} 必须是字符串`,
              path,
            ),
          );
        }
      }
    }
  }
}

function extractLocalTargets(body: string): string[] {
  const targets = new Set<string>();
  for (const match of body.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim();
    const target = raw.startsWith('<')
      ? raw.slice(1, raw.indexOf('>'))
      : raw
          .match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/)
          ?.slice(1)
          .find(Boolean);
    if (target && isLocalTarget(target)) targets.add(target);
  }
  for (const match of body.matchAll(
    /`((?:scripts|references|assets)\/[^`\r\n]+)`/g,
  )) {
    if (match[1]) targets.add(match[1].trim());
  }
  return [...targets];
}

function isLocalTarget(target: string): boolean {
  return !target.startsWith('#') && !/^(?:https?|mailto|data):/i.test(target);
}

async function validateLocalTargets(
  targets: string[],
  skillDirectory: string,
  issues: SkillValidationIssue[],
  sourcePath: string,
): Promise<void> {
  const rootRealPath = await realpath(skillDirectory);
  for (const rawTarget of targets) {
    const withoutFragment = rawTarget.split('#', 1)[0].split('?', 1)[0];
    let decoded: string;
    try {
      decoded = decodeURIComponent(withoutFragment).replaceAll('\\', '/');
    } catch {
      issues.push(
        issue(
          'error',
          'REFERENCE_ENCODING',
          `文件引用编码无效: ${rawTarget}`,
          sourcePath,
        ),
      );
      continue;
    }
    if (!decoded) continue;
    if (isAbsolute(decoded) || /^[a-z]:\//i.test(decoded)) {
      issues.push(
        issue(
          'error',
          'REFERENCE_ABSOLUTE',
          `文件引用必须使用相对路径: ${rawTarget}`,
          sourcePath,
        ),
      );
      continue;
    }

    const targetPath = resolve(skillDirectory, decoded);
    const rel = relative(skillDirectory, targetPath);
    if (isOutside(rel)) {
      issues.push(
        issue(
          'error',
          'REFERENCE_OUTSIDE_SKILL',
          `文件引用越过 Skill 根目录: ${rawTarget}`,
          sourcePath,
        ),
      );
      continue;
    }

    try {
      await stat(targetPath);
    } catch {
      issues.push(
        issue(
          'error',
          'REFERENCE_MISSING',
          `引用文件不存在: ${rawTarget}`,
          sourcePath,
        ),
      );
      continue;
    }
    const targetRealPath = await realpath(targetPath);
    const realRel = relative(rootRealPath, targetRealPath);
    if (isOutside(realRel)) {
      issues.push(
        issue(
          'error',
          'REFERENCE_SYMLINK_ESCAPE',
          `引用文件通过符号链接越过 Skill 根目录: ${rawTarget}`,
          sourcePath,
        ),
      );
      continue;
    }
    if (decoded.split('/').filter(Boolean).length > 2) {
      issues.push(
        issue(
          'warning',
          'REFERENCE_TOO_DEEP',
          `建议从 SKILL.md 仅引用一层资源目录: ${rawTarget}`,
          sourcePath,
        ),
      );
    }
  }
}

async function validateOptionalDirectories(
  skillDirectory: string,
  issues: SkillValidationIssue[],
): Promise<void> {
  for (const name of ['scripts', 'references', 'assets']) {
    const path = resolve(skillDirectory, name);
    try {
      const info = await lstat(path);
      if (!info.isDirectory()) {
        issues.push(
          issue(
            'error',
            'RESOURCE_DIRECTORY_TYPE',
            `${name}/ 必须是目录`,
            display(path),
          ),
        );
      }
    } catch (error: unknown) {
      if (getErrorCode(error) !== 'ENOENT') throw error;
    }
  }
}

function issue(
  severity: SkillValidationIssue['severity'],
  code: string,
  message: string,
  path?: string,
): SkillValidationIssue {
  return { severity, code, message, path };
}

function isOutside(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path);
}

function display(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel && !isOutside(rel) ? rel : path;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined;
}
