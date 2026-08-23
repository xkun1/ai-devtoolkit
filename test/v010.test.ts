import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml } from 'yaml';

// ── 多 Agent 支持 ──
import { isValidAgentType, DEFAULT_OUTPUT_PATHS } from '../src/format/index.js';
import { convertRule, detectRuleFormat } from '../src/convert/index.js';
import { redactContent, detectSensitiveInfo } from '../src/security/index.js';
import {
  loadRegistry,
  saveRegistry,
  registerSkill,
  listSkills,
  removeSkill,
} from '../src/lifecycle/index.js';
import {
  isSupportedNodeVersion,
  runDoctor,
  printDoctorReport,
} from '../src/doctor/index.js';
import { generateRepoMap } from '../src/repomap/index.js';
import { generateRefreshWorkflow } from '../src/refresh/index.js';
import { formatMultiModelReport } from '../src/eval/multi-model.js';
import { AGENT_TYPES } from '../src/agents.js';

const TMP_DIR = join(tmpdir(), `devtoolkit-v010-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('v0.10 — 多 Agent 类型支持', () => {
  it('isValidAgentType 支持全部 7 种 Agent', () => {
    expect(AGENT_TYPES).toHaveLength(7);
    for (const t of AGENT_TYPES) {
      expect(isValidAgentType(t)).toBe(true);
    }
    expect(isValidAgentType('invalid')).toBe(false);
  });

  it('DEFAULT_OUTPUT_PATHS 覆盖所有 Agent', () => {
    expect(DEFAULT_OUTPUT_PATHS.windsurf).toContain('.windsurf');
    expect(DEFAULT_OUTPUT_PATHS.copilot).toContain('copilot-instructions');
    expect(DEFAULT_OUTPUT_PATHS.gemini).toBe('./GEMINI.md');
    expect(DEFAULT_OUTPUT_PATHS.aider).toBe('./CONVENTIONS.md');
  });

  it('detectRuleFormat 识别新 Agent 格式', () => {
    expect(detectRuleFormat('.windsurf/rules/api.md')).toBe('windsurf');
    expect(detectRuleFormat('.github/copilot-instructions.md')).toBe('copilot');
    expect(detectRuleFormat('.github/skills/api/SKILL.md')).toBe('copilot');
    expect(detectRuleFormat('.claude/skills/api/SKILL.md')).toBe('claude');
    expect(detectRuleFormat('.gemini/skills/api/SKILL.md')).toBe('gemini');
    expect(detectRuleFormat('GEMINI.md')).toBe('gemini');
    expect(detectRuleFormat('CONVENTIONS.md')).toBe('aider');
  });

  it('convertRule 从 Codex 转为 Windsurf', () => {
    const skill = `---
name: test-skill
description: "测试技能"
---

# 测试

内容。
`;
    const res = convertRule(skill, { to: 'windsurf', outputDir: TMP_DIR });
    expect(res.to).toBe('windsurf');
    expect(res.artifacts[0].path).toContain(join('.windsurf', 'rules'));
  });

  it('convertRule 从 Codex 转为 Copilot', () => {
    const skill = `---
name: api-rules
description: "API 规范"
---

# API

使用 REST。
`;
    const res = convertRule(skill, { to: 'copilot', outputDir: TMP_DIR });
    expect(res.artifacts[0].path).toContain(
      join('.github', 'skills', 'api-rules', 'SKILL.md'),
    );
  });

  it('convertRule 从 Codex 转为 Gemini', () => {
    const skill = `---
name: db-rules
description: "数据库规范"
---

# DB

禁止裸 SQL。
`;
    const res = convertRule(skill, { to: 'gemini', outputDir: TMP_DIR });
    expect(res.artifacts[0].path).toContain(
      join('.gemini', 'skills', 'db-rules', 'SKILL.md'),
    );
  });

  it('convertRule 从 Codex 转为 Aider', () => {
    const skill = `---
name: style-guide
description: "代码风格"
---

# Style

使用 ESLint。
`;
    const res = convertRule(skill, { to: 'aider', outputDir: TMP_DIR });
    expect(res.artifacts[0].path).toContain('CONVENTIONS.md');
  });
});

describe('v0.10 — 敏感信息防护', () => {
  it('detectSensitiveInfo 检测 API Key', () => {
    const content =
      'const key = process.env.DEEPSEEK_API_KEY; // sk-abc123def456ghi789jkl012mno345';
    const result = detectSensitiveInfo(content);
    expect(result.found).toBe(true);
    expect(result.rules).toContain('sk-key');
  });

  it('redactContent 脱敏 Bearer Token', () => {
    const content =
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redactContent(content);
    expect(result.content).not.toContain(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    );
    expect(result.redactedCount).toBeGreaterThan(0);
  });

  it('redactContent 脱敏 AWS Key', () => {
    const content = 'aws_access_key_id = AKIAIOSFODNN7EXAMPLE';
    const result = redactContent(content);
    expect(result.content).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redactContent 脱敏 OpenSSH 私钥块', () => {
    const content =
      '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-material\n-----END OPENSSH PRIVATE KEY-----';
    const result = redactContent(content);
    expect(result.content).not.toContain('secret-material');
    expect(result.matchedRules).toContain('private-key-block');
  });

  it('redactContent 不修改无敏感信息的文本', () => {
    const content = '# 正常文档\n\n这是一段普通文本。';
    const result = redactContent(content);
    expect(result.redactedCount).toBe(0);
    expect(result.content).toBe(content);
  });
});

describe('v0.10 — 技能包生命周期管理', () => {
  it('loadRegistry 返回空注册表', async () => {
    const registry = await loadRegistry(TMP_DIR);
    expect(registry.skills).toEqual({});
    expect(registry.version).toBe('1.0.0');
  });

  it('registerSkill + saveRegistry + loadRegistry 往返', async () => {
    const registry = await loadRegistry(TMP_DIR);
    registerSkill(registry, {
      name: 'test-skill',
      agentType: 'codex',
      primaryPath: '.agents/skills/test-skill/SKILL.md',
      artifactPaths: ['.agents/skills/test-skill/SKILL.md'],
      sourceFingerprint: 'abc123',
      generatedAt: Date.now(),
    });
    await saveRegistry(registry);

    const loaded = await loadRegistry(TMP_DIR);
    expect(loaded.skills['test-skill']).toBeDefined();
    expect(loaded.skills['test-skill'].version).toBe(1);
  });

  it('registerSkill 拒绝原型污染保留键', async () => {
    const registry = await loadRegistry(TMP_DIR);
    expect(() =>
      registerSkill(registry, {
        name: '__proto__',
        agentType: 'codex',
        primaryPath: 'SKILL.md',
        artifactPaths: ['SKILL.md'],
        sourceFingerprint: 'safe',
        generatedAt: Date.now(),
      }),
    ).toThrow('技能名');
    expect(Object.getPrototypeOf(registry.skills)).toBe(Object.prototype);
  });

  it('removeSkill 删除注册表条目', async () => {
    const registry = await loadRegistry(TMP_DIR);
    registerSkill(registry, {
      name: 'to-remove',
      agentType: 'cursor',
      primaryPath: '.cursor/rules/to-remove.mdc',
      artifactPaths: [],
      sourceFingerprint: 'xyz',
      generatedAt: Date.now(),
    });
    await saveRegistry(registry);

    // 创建假文件
    const filePath = join(TMP_DIR, '.cursor/rules/to-remove.mdc');
    await mkdir(join(TMP_DIR, '.cursor', 'rules'), { recursive: true });
    await writeFile(filePath, 'test content');

    const removed = await removeSkill('to-remove', TMP_DIR);
    expect(removed).toBe(true);
    expect(existsSync(filePath)).toBe(false);

    const after = await loadRegistry(TMP_DIR);
    expect(after.skills['to-remove']).toBeUndefined();
  });

  it('removeSkill 显式拒绝上级目录越界产物路径', async () => {
    const project = join(TMP_DIR, 'project');
    const victim = join(TMP_DIR, 'victim.txt');
    const maliciousPath = '../victim.txt';
    await mkdir(project, { recursive: true });
    await writeFile(victim, 'do not delete');
    await writeFile(
      join(project, '.devtoolkit-skills.json'),
      JSON.stringify({
        version: '1.0.0',
        projectRoot: TMP_DIR,
        skills: {
          malicious: {
            name: 'malicious',
            agentType: 'codex',
            primaryPath: maliciousPath,
            artifactPaths: [maliciousPath],
            sourceFingerprint: 'forged',
            generatedAt: Date.now(),
            version: 1,
          },
        },
      }),
    );

    await expect(removeSkill('malicious', project)).rejects.toThrow(
      '上级目录段',
    );
    expect(existsSync(victim)).toBe(true);
  });

  it('loadRegistry 兼容忽略旧版绝对路径条目', async () => {
    const project = join(TMP_DIR, 'project');
    const victim = join(TMP_DIR, 'victim.txt');
    await mkdir(project, { recursive: true });
    await writeFile(victim, 'do not delete');
    await writeFile(
      join(project, '.devtoolkit-skills.json'),
      JSON.stringify({
        version: '1.0.0',
        projectRoot: TMP_DIR,
        skills: {
          legacy: {
            name: 'legacy',
            agentType: 'codex',
            primaryPath: victim,
            artifactPaths: [victim],
            sourceFingerprint: 'legacy',
            generatedAt: Date.now(),
            version: 1,
          },
        },
      }),
    );

    expect(await removeSkill('legacy', project)).toBe(false);
    expect(existsSync(victim)).toBe(true);
  });

  it('removeSkill 忽略伪造 projectRoot 并阻止符号链接目录逃逸', async () => {
    const project = join(TMP_DIR, 'project');
    const outside = join(TMP_DIR, 'outside');
    const victim = join(outside, 'victim.txt');
    await mkdir(project, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(victim, 'do not delete');
    await symlink(
      outside,
      join(project, '.cursor'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await writeFile(
      join(project, '.devtoolkit-skills.json'),
      JSON.stringify({
        version: '1.0.0',
        projectRoot: outside,
        skills: {
          malicious: {
            name: 'malicious',
            agentType: 'cursor',
            primaryPath: '.cursor/victim.txt',
            artifactPaths: ['.cursor/victim.txt'],
            sourceFingerprint: 'forged',
            generatedAt: Date.now(),
            version: 1,
          },
        },
      }),
    );

    await expect(removeSkill('malicious', project)).rejects.toThrow(
      '真实路径越过项目边界',
    );
    expect(existsSync(victim)).toBe(true);
  });

  it('loadRegistry 不信任持久化 projectRoot', async () => {
    const project = join(TMP_DIR, 'project');
    const outsideVictim = join(TMP_DIR, 'victim.txt');
    await mkdir(project, { recursive: true });
    await writeFile(outsideVictim, 'do not delete');
    await writeFile(
      join(project, '.devtoolkit-skills.json'),
      JSON.stringify({
        version: '1.0.0',
        projectRoot: TMP_DIR,
        skills: {
          forged: {
            name: 'forged',
            agentType: 'cursor',
            primaryPath: 'victim.txt',
            artifactPaths: ['victim.txt'],
            sourceFingerprint: 'forged',
            generatedAt: Date.now(),
            version: 1,
          },
        },
      }),
    );

    expect((await loadRegistry(project)).projectRoot).toBe(project);
    expect(await removeSkill('forged', project)).toBe(true);
    expect(existsSync(outsideVictim)).toBe(true);
  });

  it('removeSkill 仅删除登记产物，不递归删除 Codex 目录', async () => {
    const project = join(TMP_DIR, 'project');
    const skillDir = join(project, '.agents', 'skills', 'safe-skill');
    const primaryPath = '.agents/skills/safe-skill/SKILL.md';
    const referencePath = '.agents/skills/safe-skill/references/details.md';
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await writeFile(join(project, primaryPath), '# Skill');
    await writeFile(join(project, referencePath), '# Details');
    await writeFile(join(skillDir, 'keep.txt'), 'untracked');
    const registry = await loadRegistry(project);
    registerSkill(registry, {
      name: 'safe-skill',
      agentType: 'codex',
      primaryPath,
      artifactPaths: [primaryPath, referencePath],
      sourceFingerprint: 'safe',
      generatedAt: Date.now(),
    });
    await saveRegistry(registry);

    expect(await removeSkill('safe-skill', project)).toBe(true);
    expect(existsSync(join(project, primaryPath))).toBe(false);
    expect(existsSync(join(project, referencePath))).toBe(false);
    expect(existsSync(join(skillDir, 'keep.txt'))).toBe(true);
  });

  it('注册表损坏时显式失败，不静默退化为空注册表', async () => {
    await writeFile(join(TMP_DIR, '.devtoolkit-skills.json'), '{invalid');
    await expect(loadRegistry(TMP_DIR)).rejects.toThrow('JSON 解析失败');
  });

  it('listSkills 返回状态列表', async () => {
    const registry = await loadRegistry(TMP_DIR);
    registerSkill(registry, {
      name: 'listed',
      agentType: 'claude',
      primaryPath: 'CLAUDE.md',
      artifactPaths: ['CLAUDE.md'],
      sourceFingerprint: 'fp',
      generatedAt: Date.now(),
    });
    await saveRegistry(registry);

    const skills = await listSkills(TMP_DIR);
    expect(skills.length).toBeGreaterThanOrEqual(1);
    const found = skills.find((s) => s.name === 'listed');
    expect(found).toBeDefined();
    expect(found!.agentType).toBe('claude');
  });
});

describe('v0.10 — devtoolkit doctor', () => {
  it('严格执行 Node.js >= 20.19 版本边界', () => {
    expect(isSupportedNodeVersion('v20.18.1')).toBe(false);
    expect(isSupportedNodeVersion('v20.19.0')).toBe(true);
    expect(isSupportedNodeVersion('v22.0.0')).toBe(true);
    expect(isSupportedNodeVersion('invalid')).toBe(false);
  });

  it('runDoctor 返回结构化报告', async () => {
    const report = await runDoctor(TMP_DIR);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.summary).toHaveProperty('ok');
    expect(report.summary).toHaveProperty('warn');
    expect(report.summary).toHaveProperty('error');
  });

  it('printDoctorReport 不抛异常', async () => {
    const report = await runDoctor(TMP_DIR);
    expect(() => printDoctorReport(report)).not.toThrow();
  });
});

describe('v0.10 — Repo Map', () => {
  it('generateRepoMap 输出项目结构摘要', async () => {
    // 创建测试文件
    const srcDir = join(TMP_DIR, 'src');
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, 'index.ts'),
      'export function hello() { return "world"; }\nexport class Foo {}\n',
    );

    const map = await generateRepoMap({ root: TMP_DIR });
    expect(map).toContain('# Repo Map');
    expect(map).toContain('index.ts');
    expect(map).toContain('typescript');
  });
});

describe('v0.10 — 自动刷新工作流生成器', () => {
  it('generateRefreshWorkflow 输出合法 YAML 结构', () => {
    const yaml = generateRefreshWorkflow({
      sources: ['https://docs.example.com/api'],
      agentType: 'codex',
      model: 'deepseek-chat',
    });
    expect(yaml).toContain('devtoolkit-refresh');
    expect(yaml).toContain('schedule:');
    expect(yaml).toContain('cron:');
    expect(yaml).toContain('create-pull-request');
    expect(yaml).toContain('--force');
    expect(yaml).toContain('ai-devtoolkit@0.10.0');
    expect(yaml).toContain('actions/checkout@v7');
    expect(yaml).toContain('actions/setup-node@v7');
    expect(parseYaml(yaml)).toHaveProperty('jobs.refresh-skills');
  });

  it('支持自定义 cron 和模型', () => {
    const yaml = generateRefreshWorkflow({
      sources: ['./docs/'],
      agentType: 'claude',
      cron: '0 */6 * * *',
      model: 'gpt-4o',
    });
    const parsed = parseYaml(yaml);
    expect(parsed.on.schedule[0].cron).toBe('0 */6 * * *');
    expect(
      parsed.jobs['refresh-skills'].steps.find(
        (step: { name?: string }) => step.name === 'Generate skill packs',
      ).env.DEVTOOLKIT_MODEL,
    ).toBe('gpt-4o');
  });

  it('来源参数通过 Base64 JSON 传递，不进入 shell 或 GitHub 表达式', () => {
    const source = 'docs/$(touch injected) " ${{ secrets.DANGER }}.md';
    const yaml = generateRefreshWorkflow({
      sources: [source],
      agentType: 'codex',
      model: 'deepseek-chat',
    });
    expect(yaml).not.toContain(source);

    const parsed = parseYaml(yaml);
    const generateStep = parsed.jobs['refresh-skills'].steps.find(
      (step: { name?: string }) => step.name === 'Generate skill packs',
    );
    expect(generateStep.run).not.toContain('touch injected');
    const decoded = JSON.parse(
      Buffer.from(generateStep.env.DEVTOOLKIT_SOURCES_B64, 'base64').toString(
        'utf-8',
      ),
    );
    expect(decoded).toEqual([source]);
  });

  it('拒绝可注入控制字符及非法工作流参数', () => {
    expect(() =>
      generateRefreshWorkflow({
        sources: ['docs/good.md\nrun: injected'],
        agentType: 'codex',
      }),
    ).toThrow('来源路径无效');
    expect(() =>
      generateRefreshWorkflow({
        sources: ['docs/good.md'],
        agentType: 'codex',
        model: 'safe; touch injected',
      }),
    ).toThrow('模型名无效');
    expect(() =>
      generateRefreshWorkflow({
        sources: ['docs/good.md'],
        agentType: 'codex',
        apiKeyEnvVar: 'KEY\nBAD',
      }),
    ).toThrow('环境变量名无效');
  });
});

describe('v0.10 — 多模型对比评测', () => {
  it('formatMultiModelReport 输出 Markdown 表格', () => {
    const mockResult = {
      results: [
        {
          label: 'model-a',
          report: null,
          error: 'API unavailable',
        },
        {
          label: 'model-b',
          report: {
            skillName: 'test',
            evaluatedAt: new Date().toISOString(),
            model: 'mock-b',
            totalCases: 2,
            avgTriggerScore: 85,
            avgAccuracyScore: 90,
            avgBaselineScore: 60,
            avgImprovementScore: 30,
            overallScore: 88,
            grade: 'A' as const,
            caseResults: [],
            suggestions: [],
          },
        },
      ],
      bestModel: 'model-b',
    };
    const md = formatMultiModelReport(
      mockResult as Parameters<typeof formatMultiModelReport>[0],
    );
    expect(md).toContain('| model-a | ❌ 失败 |');
    expect(md).toContain('| model-b | 88 | A |');
    expect(md).toContain('🏆 **最佳模型**: model-b');
  });
});
