import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { createArtifactZip } from '../src/utils/zip.js';

describe('完整技能包 ZIP', () => {
  it('Codex 多文件保留相对目录和完整内容', async () => {
    const skill = '---\nname: demo-skill\ndescription: "Demo"\n---\n\n# Demo\n';
    const archive = await createArtifactZip(
      [
        {
          path: '.agents/skills/demo-skill/SKILL.md',
          content: skill,
          kind: 'primary',
        },
        {
          path: '.agents/skills/demo-skill/references/details.md',
          content: '# Details\n',
          kind: 'reference',
        },
      ],
      'codex',
    );
    const zip = await JSZip.loadAsync(archive.buffer);

    expect(archive.filename).toBe('demo-skill-codex-skill.zip');
    expect(archive.entries).toEqual([
      '.agents/skills/demo-skill/SKILL.md',
      '.agents/skills/demo-skill/references/details.md',
    ]);
    expect(
      await zip.file('.agents/skills/demo-skill/SKILL.md')?.async('string'),
    ).toBe(skill);
    expect(
      await zip
        .file('.agents/skills/demo-skill/references/details.md')
        ?.async('string'),
    ).toBe('# Details\n');
  });

  it('Claude 包保留 CLAUDE.md 与 .claude/rules', async () => {
    const archive = await createArtifactZip(
      [
        { path: 'CLAUDE.md', content: '# Project\n', kind: 'primary' },
        {
          path: '.claude/rules/project.md',
          content: '# Rules\n',
          kind: 'rule',
        },
      ],
      'claude',
    );
    const zip = await JSZip.loadAsync(archive.buffer);
    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['CLAUDE.md', '.claude/rules/project.md']),
    );
  });

  it('拒绝路径穿越和绝对路径', async () => {
    await expect(
      createArtifactZip(
        [{ path: '../secret.md', content: 'x', kind: 'primary' }],
        'codex',
      ),
    ).rejects.toThrow('不安全');
    await expect(
      createArtifactZip(
        [{ path: '/tmp/secret.md', content: 'x', kind: 'primary' }],
        'codex',
      ),
    ).rejects.toThrow('不能打包');
  });
});
