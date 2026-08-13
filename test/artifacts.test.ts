import { describe, expect, it } from 'vitest';
import { buildArtifacts, resolvePrimaryPath } from '../src/format/artifacts.js';

const doc = {
  source: 'docs.md',
  type: 'markdown' as const,
  title: 'React Hooks Guide',
  content: '# React Hooks Guide\n\nSource body long enough for tests.',
};

describe('modern artifacts', () => {
  it('Codex 默认输出标准技能目录', () => {
    const result = buildArtifacts({
      agentType: 'codex',
      content: '# React Skill\n\n## Usage\n- Use hooks.',
      doc,
    });

    expect(result.suggestedPath).toBe(
      '.agents/skills/react-hooks-guide/SKILL.md',
    );
    expect(result.content).toContain('name: react-hooks-guide');
    expect(result.artifacts).toHaveLength(1);
  });

  it('Cursor 默认输出 .cursor/rules/*.mdc 并注入元数据', () => {
    const result = buildArtifacts({
      agentType: 'cursor',
      content: '# Rules\n\n- Prefer TypeScript.',
      doc,
    });

    expect(result.suggestedPath).toBe('.cursor/rules/react-hooks-guide.mdc');
    expect(result.content).toMatch(
      /^---\ndescription: ".+"\nglobs: "\*\*\/\*"\nalwaysApply: false\n---/,
    );
  });

  it('Claude 超过 200 行时拆到 .claude/rules', () => {
    const content = `# Project\n\n${Array.from({ length: 220 }, (_, i) => `- Rule ${i}`).join('\n')}`;
    const result = buildArtifacts({ agentType: 'claude', content, doc });

    expect(result.suggestedPath).toBe('CLAUDE.md');
    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts?.[1].path).toBe(
      '.claude/rules/react-hooks-guide.md',
    );
    expect(result.content.split('\n').length).toBeLessThan(200);
    expect(result.artifacts?.[1].content).toContain('Rule 219');
  });

  it('Codex 超长内容使用 references 渐进披露且不丢章节', () => {
    const section = (n: number) =>
      `## Section ${n}\n${Array.from({ length: 100 }, (_, i) => `- Item ${n}-${i}`).join('\n')}`;
    const content = `# Big Skill\n\n${[1, 2, 3, 4, 5].map(section).join('\n\n')}`;
    const result = buildArtifacts({ agentType: 'codex', content, doc });

    expect(result.artifacts).toHaveLength(2);
    expect(result.artifacts?.[1].path).toContain('/references/details.md');
    expect(result.content).toContain('详细参考');
    expect(result.artifacts?.map((item) => item.content).join('\n')).toContain(
      'Item 5-99',
    );
  });

  it('legacy 保留旧版单文件路径', () => {
    expect(
      resolvePrimaryPath('cursor', doc, undefined, undefined, 'legacy'),
    ).toBe('.cursorrules');
    const result = buildArtifacts({
      agentType: 'cursor',
      content: '# Rules',
      doc,
      outputMode: 'legacy',
    });
    expect(result.content).not.toMatch(/^---/);
  });

  it('显式输出路径始终优先', () => {
    expect(
      resolvePrimaryPath('codex', doc, undefined, '/tmp/custom.md', 'modern'),
    ).toBe('/tmp/custom.md');
  });

  it('Codex 显式单文件路径不会额外写 references', () => {
    const content = `# Big\n\n${Array.from({ length: 500 }, (_, i) => `## S${i}\n- Item`).join('\n')}`;
    const result = buildArtifacts({
      agentType: 'codex',
      content,
      doc,
      outputPath: '/tmp/custom-skill.md',
    });
    expect(result.artifacts).toHaveLength(1);
    expect(result.suggestedPath).toBe('/tmp/custom-skill.md');
  });

  it('自动移除模型常见的整文件 Markdown 围栏', () => {
    const result = buildArtifacts({
      agentType: 'claude',
      content: '```markdown\n# Project\n\n- Run tests.\n```',
      doc,
    });
    expect(result.content).toBe('# Project\n\n- Run tests.\n');
  });
});
