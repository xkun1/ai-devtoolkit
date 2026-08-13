import { describe, expect, it } from 'vitest';
import { validateSkillResult } from '../src/quality/validate.js';

describe('生成质量基线', () => {
  it('通过合法 Codex 技能', () => {
    const content =
      '---\nname: api-guide\ndescription: "API 使用指南"\n---\n\n# API\n\n- 使用精确命令。\n';
    const report = validateSkillResult({
      agentType: 'codex',
      content,
      suggestedPath: '.agents/skills/api-guide/SKILL.md',
    });
    expect(report.passed).toBe(true);
    expect(report.score).toBe(100);
  });

  it('拒绝缺少 frontmatter 的 Codex 技能', () => {
    const report = validateSkillResult({
      agentType: 'codex',
      content: '# Invalid\n',
      suggestedPath: 'SKILL.md',
    });
    expect(report.passed).toBe(false);
    expect(report.issues.map((item) => item.code)).toContain(
      'CODEX_FRONTMATTER',
    );
  });

  it('拒绝整个文件被代码围栏包裹', () => {
    const report = validateSkillResult({
      agentType: 'claude',
      content: '```markdown\n# Wrapped\n```\n',
      suggestedPath: 'CLAUDE.md',
    });
    expect(report.issues.map((item) => item.code)).toContain(
      'WRAPPED_MARKDOWN',
    );
  });

  it('拒绝未闭合代码围栏（常见于模型输出截断）', () => {
    const report = validateSkillResult({
      agentType: 'claude',
      content: '# Commands\n\n```bash\nnpm test\n',
      suggestedPath: 'CLAUDE.md',
    });
    expect(report.issues.map((item) => item.code)).toContain('UNCLOSED_FENCE');
  });
});
