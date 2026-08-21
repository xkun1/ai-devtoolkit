import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
import { runDoctor, printDoctorReport } from '../src/doctor/index.js';
import { generateRepoMap } from '../src/repomap/index.js';
import { generateRefreshWorkflow } from '../src/refresh/index.js';
import { formatMultiModelReport } from '../src/eval/multi-model.js';

const TMP_DIR = join(tmpdir(), `devtoolkit-v010-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('v0.10 — 多 Agent 类型支持', () => {
  it('isValidAgentType 支持全部 7 种 Agent', () => {
    for (const t of [
      'codex',
      'cursor',
      'claude',
      'windsurf',
      'copilot',
      'gemini',
      'aider',
    ]) {
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
    expect(res.artifacts[0].path).toContain('.windsurf/rules');
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
    expect(res.artifacts[0].path).toContain('.github/copilot-instructions.md');
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
    expect(res.artifacts[0].path).toContain('GEMINI.md');
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
  });

  it('支持自定义 cron 和模型', () => {
    const yaml = generateRefreshWorkflow({
      sources: ['./docs/'],
      agentType: 'claude',
      cron: '0 */6 * * *',
      model: 'gpt-4o',
    });
    expect(yaml).toContain("'0 */6 * * *'");
    expect(yaml).toContain('gpt-4o');
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
