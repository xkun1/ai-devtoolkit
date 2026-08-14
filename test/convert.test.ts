import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectRuleFormat,
  parseRule,
  convertRule,
  discoverProjectRules,
  syncProjectRules,
} from '../src/convert/index.js';

const TMP_DIR = join(tmpdir(), `devtoolkit-convert-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('跨 Agent 规则互转 — 格式检测与解析', () => {
  it('detectRuleFormat 正确识别各类规则', () => {
    expect(detectRuleFormat('.cursor/rules/api.mdc')).toBe('cursor');
    expect(detectRuleFormat('.agents/skills/react/SKILL.md')).toBe('codex');
    expect(detectRuleFormat('CLAUDE.md')).toBe('claude');
    expect(detectRuleFormat(undefined, '---\nglobs: "**/*"\n---')).toBe(
      'cursor',
    );
    expect(detectRuleFormat(undefined, '---\nname: my-skill\n---')).toBe(
      'codex',
    );
  });

  it('parseRule 正确提取 Cursor MDC Frontmatter', () => {
    const mdc = `---
description: "React 开发规范"
globs: ["src/**/*.tsx", "src/**/*.ts"]
alwaysApply: true
---

# React 规范

编写函数式组件，遵循 Hooks 规则。
`;
    const parsed = parseRule(mdc, 'rules/react.mdc');
    expect(parsed.format).toBe('cursor');
    expect(parsed.meta.description).toBe('React 开发规范');
    expect(parsed.meta.globs).toEqual(['src/**/*.tsx', 'src/**/*.ts']);
    expect(parsed.meta.alwaysApply).toBe(true);
    expect(parsed.body).toContain('# React 规范');
  });

  it('parseRule 正确提取 Codex SKILL.md Frontmatter', () => {
    const skill = `---
name: stripe-api
description: "Stripe 支付接口调用指南"
---

# Stripe 支付

调用 PaymentIntents API。
`;
    const parsed = parseRule(skill, '.agents/skills/stripe-api/SKILL.md');
    expect(parsed.format).toBe('codex');
    expect(parsed.meta.name).toBe('stripe-api');
    expect(parsed.meta.description).toBe('Stripe 支付接口调用指南');
    expect(parsed.body).toContain('# Stripe 支付');
  });
});

describe('跨 Agent 规则互转 — 转换引擎 (convertRule)', () => {
  it('从 Cursor 转为 Codex 官方结构', () => {
    const mdc = `---
description: "TypeScript 编码规范"
globs: "**/*.ts"
alwaysApply: false
---

# TS 规范

开启 strict: true。
`;
    const res = convertRule(mdc, { to: 'codex', outputDir: TMP_DIR });
    expect(res.to).toBe('codex');
    expect(res.artifacts.length).toBe(1);
    expect(res.artifacts[0].path).toContain('.agents/skills');
    expect(res.artifacts[0].content).toContain('name:');
    expect(res.artifacts[0].content).toContain(
      'description: "TypeScript 编码规范"',
    );
    expect(res.artifacts[0].content).toContain('开启 strict: true');
  });

  it('从 Codex 转为 Cursor 官方结构', () => {
    const skill = `---
name: database-rules
description: "数据库操作规范"
---

# DB 规范

禁止在循环中执行 SQL。
`;
    const res = convertRule(skill, { to: 'cursor', outputDir: TMP_DIR });
    expect(res.to).toBe('cursor');
    expect(res.artifacts.length).toBe(1);
    expect(res.artifacts[0].path).toContain('.cursor/rules/database-rules.mdc');
    expect(res.artifacts[0].content).toContain('description: "数据库操作规范"');
    expect(res.artifacts[0].content).toContain('globs: "**/*"');
    expect(res.artifacts[0].content).toContain('alwaysApply: false');
  });

  it('从 Codex 转为 Claude Code 结构', () => {
    const skill = `---
name: project-guidelines
description: "项目通用规范"
---

# 通用规范

全部提交遵循中文 Commit 规范。
`;
    const res = convertRule(skill, { to: 'claude', outputDir: TMP_DIR });
    expect(res.to).toBe('claude');
    expect(res.artifacts[0].path).toContain('CLAUDE.md');
    expect(res.artifacts[0].content).toContain('全部提交遵循中文 Commit 规范');
  });
});

describe('跨 Agent 规则互转 — 项目全量同步 (syncProjectRules)', () => {
  it('自动发现项目规则并一键分发到其他 Agent', async () => {
    // 1. 在临时项目中创建 Cursor 规则
    const cursorRulesDir = join(TMP_DIR, '.cursor', 'rules');
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(
      join(cursorRulesDir, 'auth.mdc'),
      `---
description: "用户鉴权逻辑"
globs: "src/auth/**/*"
alwaysApply: true
---

# 鉴权规范

JWT 必须设置有效期。
`,
    );

    // 2. 发现规则
    const discovered = await discoverProjectRules(TMP_DIR);
    expect(discovered.length).toBe(1);
    expect(discovered[0].agentType).toBe('cursor');
    expect(discovered[0].files.length).toBe(1);

    // 3. 执行同步
    const syncRes = await syncProjectRules({
      projectRoot: TMP_DIR,
      from: 'cursor',
      to: ['codex', 'claude'],
      dryRun: false,
    });

    expect(syncRes.summary.totalDiscovered).toBe(1);
    expect(syncRes.summary.totalSynced).toBeGreaterThanOrEqual(2);

    // 4. 验证 Codex 产物已生成
    const codexFile = join(TMP_DIR, '.agents', 'skills', 'auth', 'SKILL.md');
    const codexContent = await readFile(codexFile, 'utf-8');
    expect(codexContent).toContain('name: auth');
    expect(codexContent).toContain('JWT 必须设置有效期');

    // 5. 验证 Claude 产物已生成
    const claudeFile = join(TMP_DIR, 'CLAUDE.md');
    const claudeContent = await readFile(claudeFile, 'utf-8');
    expect(claudeContent).toContain('JWT 必须设置有效期');
  });

  it('dryRun 模式不实际写入磁盘', async () => {
    const cursorRulesDir = join(TMP_DIR, '.cursor', 'rules');
    await mkdir(cursorRulesDir, { recursive: true });
    await writeFile(
      join(cursorRulesDir, 'test.mdc'),
      '---\ndescription: "测试"\n---\n# Test',
    );

    const syncRes = await syncProjectRules({
      projectRoot: TMP_DIR,
      to: ['codex'],
      dryRun: true,
    });

    expect(syncRes.operations.length).toBeGreaterThan(0);
    const codexFile = join(TMP_DIR, '.agents', 'skills', 'test', 'SKILL.md');
    const { existsSync } = await import('node:fs');
    expect(existsSync(codexFile)).toBe(false);
  });
});
