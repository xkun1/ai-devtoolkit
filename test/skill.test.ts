import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compileSkill,
  createSkillIR,
  validateSkillTarget,
} from '../src/skill/index.js';

let workspace = '';

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'devtoolkit-skill-test-'));
});

afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe('统一 Skill IR 与编译器', () => {
  it('解析标准 frontmatter，并由同一 IR 编译多个平台', () => {
    const ir = createSkillIR({
      content: `---
name: api-helper
description: "调用内部 API；适用于接口开发和联调"
license: MIT
metadata:
  author: team
---

# API Helper

## 使用

- 先读取接口定义。`,
      resources: [
        {
          path: 'references/api.md',
          content: '# API Reference',
          kind: 'reference',
        },
      ],
    });

    expect(ir.metadata).toMatchObject({
      name: 'api-helper',
      description: '调用内部 API；适用于接口开发和联调',
      license: 'MIT',
      metadata: { author: 'team' },
    });
    expect(ir.instructions).not.toContain('name: api-helper');

    const claude = compileSkill(ir, { agentType: 'claude' });
    const copilot = compileSkill(ir, { agentType: 'copilot' });
    const cursor = compileSkill(ir, { agentType: 'cursor' });

    expect(claude.suggestedPath).toBe(
      join('.claude', 'skills', 'api-helper', 'SKILL.md'),
    );
    expect(copilot.suggestedPath).toBe(
      join('.github', 'skills', 'api-helper', 'SKILL.md'),
    );
    expect(cursor.suggestedPath).toBe(
      join('.cursor', 'rules', 'api-helper.mdc'),
    );
    expect(claude.content).toContain('metadata:\n  author: "team"');
    expect(claude.artifacts?.[1]).toMatchObject({
      path: join('.claude', 'skills', 'api-helper', 'references', 'api.md'),
      kind: 'reference',
    });
    expect(cursor.content).toContain('globs: "**/*"');
    expect(cursor.artifacts?.[1].path).toBe(
      join('.cursor', 'rules', 'references', 'api.md'),
    );
  });

  it('拒绝越界或覆盖主文件的资源路径', () => {
    expect(() =>
      createSkillIR({
        content: '---\nname: empty\ndescription: "empty"\n---\n',
      }),
    ).toThrow('instructions 不能为空');

    expect(() =>
      createSkillIR({
        content: '# Test',
        name: 'test',
        resources: [{ path: '../secret', content: 'x', kind: 'asset' }],
      }),
    ).toThrow('路径不安全');

    expect(() =>
      createSkillIR({
        content: '# Test',
        name: 'test',
        resources: [{ path: 'SKILL.md', content: 'x', kind: 'reference' }],
      }),
    ).toThrow('路径无效');

    expect(() =>
      createSkillIR({
        content: '# Test',
        name: 'test',
        resources: [{ path: 'references/', content: 'x', kind: 'reference' }],
      }),
    ).toThrow('路径不安全');
  });

  it('编译器拒绝绕过 IR 工厂注入非法元数据或资源路径', () => {
    const ir = createSkillIR({
      content: '# Safe',
      name: 'safe-skill',
      description: '安全技能；适用于验证编译器输入边界',
    });

    expect(() =>
      compileSkill(
        { ...ir, metadata: { ...ir.metadata, name: '../outside' } },
        { agentType: 'codex' },
      ),
    ).toThrow('Skill name');

    expect(() =>
      compileSkill(
        {
          ...ir,
          resources: [
            { path: '../outside.md', content: 'x', kind: 'reference' },
          ],
        },
        { agentType: 'codex' },
      ),
    ).toThrow('资源路径不安全');

    expect(() =>
      compileSkill(
        {
          ...ir,
          resources: [
            { path: 'CONVENTIONS.md', content: 'x', kind: 'reference' },
          ],
        },
        { agentType: 'aider' },
      ),
    ).toThrow('不能覆盖主文件');
  });
});

describe('Agent Skills 规范校验', () => {
  it('校验合法技能及本地引用', async () => {
    const skillDir = join(workspace, '.agents', 'skills', 'api-helper');
    await mkdir(join(skillDir, 'references'), { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: api-helper
description: "调用内部 API；适用于接口开发、联调和故障排查"
metadata:
  author: "team"
---

# API Helper

读取 [接口参考](references/api.md)。
`,
    );
    await writeFile(join(skillDir, 'references', 'api.md'), '# API\n');

    const summary = await validateSkillTarget(workspace);
    expect(summary.passed).toBe(true);
    expect(summary.totals).toEqual({ skills: 1, errors: 0, warnings: 0 });
    expect(summary.reports[0].metrics.references).toBe(1);
  });

  it('发现命名不一致、非法 metadata 与缺失引用', async () => {
    const skillDir = join(workspace, 'wrong-directory');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: valid-name
description: "short"
metadata:
  version: 1
unknown-field: true
---

读取 [缺失文件](references/missing.md)。
`,
    );

    const summary = await validateSkillTarget(skillDir, { strict: true });
    const codes = summary.reports[0].issues.map((item) => item.code);
    expect(summary.passed).toBe(false);
    expect(codes).toEqual(
      expect.arrayContaining([
        'NAME_DIRECTORY_MISMATCH',
        'DESCRIPTION_TOO_GENERIC',
        'METADATA_VALUE_TYPE',
        'UNKNOWN_FRONTMATTER_KEY',
        'REFERENCE_MISSING',
      ]),
    );
  });

  it('阻止引用越过 Skill 根目录', async () => {
    const skillDir = join(workspace, 'safe-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(workspace, 'outside.md'), '# Outside\n');
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: safe-skill
description: "安全处理资源；适用于需要读取本地参考文件的任务"
---

[禁止越界](../outside.md)
`,
    );

    const summary = await validateSkillTarget(skillDir);
    expect(summary.passed).toBe(false);
    expect(summary.reports[0].issues.map((item) => item.code)).toContain(
      'REFERENCE_OUTSIDE_SKILL',
    );
  });

  it('严格模式会把规范建议警告升级为失败结果', async () => {
    const skillDir = join(workspace, 'short-description');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: short-description
description: "简短说明"
---

# Skill
`,
    );

    expect((await validateSkillTarget(skillDir)).passed).toBe(true);
    const strict = await validateSkillTarget(skillDir, { strict: true });
    expect(strict.passed).toBe(false);
    expect(strict.totals).toEqual({ skills: 1, errors: 0, warnings: 1 });
  });

  it('目标不存在时返回结构化错误而不是抛出异常', async () => {
    const summary = await validateSkillTarget(join(workspace, 'missing'));
    expect(summary.passed).toBe(false);
    expect(summary.issues).toEqual([
      expect.objectContaining({ code: 'TARGET_NOT_FOUND' }),
    ]);
    expect(summary.totals).toEqual({ skills: 0, errors: 1, warnings: 0 });
  });
});
