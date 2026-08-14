import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectEnvironment, maskSensitive } from '../src/env/detector.js';
import { exportEnvironment, generateSetupScript } from '../src/env/exporter.js';
import {
  importEnvironment,
  loadSnapshot,
  formatImportPreview,
  diffEnvironment,
  formatDiffPreview,
} from '../src/env/importer.js';
import type { EnvSnapshot } from '../src/env/types.js';

const TMP_DIR = join(tmpdir(), `devtoolkit-env-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

const MOCK_SNAPSHOT: EnvSnapshot = {
  version: '1.0.0',
  exportedAt: '2026-08-14T00:00:00.000Z',
  system: {
    platform: 'darwin',
    arch: 'arm64',
    osVersion: '23.0.0',
    hostname: 'test-mac',
    username: 'tester',
    shell: '/bin/zsh',
  },
  brew: {
    formulae: ['node', 'git', 'ripgrep', 'jq'],
    casks: ['visual-studio-code', 'iterm2'],
  },
  npmGlobal: [
    { name: 'typescript', version: '5.3.3' },
    { name: 'pnpm', version: '8.15.0' },
  ],
  pipPackages: [
    { name: 'requests', version: '2.31.0' },
    { name: 'pytest', version: '8.0.0' },
  ],
  vscodeExtensions: [
    { id: 'dbaeumer.vscode-eslint', version: '2.4.4' },
    { id: 'esbenp.prettier-vscode', version: '10.1.0' },
  ],
  git: {
    config: 'user.name=Tester\nuser.email=tester@example.com',
  },
  shell: {
    shell: '/bin/zsh',
    files: [
      {
        name: '.zshrc',
        path: '/home/tester/.zshrc',
        content: 'export PATH=$PATH:/custom/bin',
      },
    ],
  },
  ssh: {
    config: 'Host github.com\n  User git',
    hasKeys: true,
  },
};

describe('环境迁移 — 探测与安全脱敏', () => {
  it('maskSensitive 正确过滤 Token/Password/ApiKey', () => {
    const raw = [
      'export OPENAI_API_KEY="sk-1234567890abcdef123456"',
      'git.token = ghp_secretpassword123456',
      'user_password: mysecretpassword999',
      'regular_setting = standard_value',
    ].join('\n');

    const masked = maskSensitive(raw);
    expect(masked).toContain('***MASKED***');
    expect(masked).not.toContain('sk-1234567890abcdef123456');
    expect(masked).not.toContain('ghp_secretpassword123456');
    expect(masked).not.toContain('mysecretpassword999');
    expect(masked).toContain('regular_setting = standard_value');
  });

  it('detectEnvironment 返回有效系统信息', async () => {
    const env = await detectEnvironment({ modules: ['sdks'] });
    expect(env.version).toBe('1.0.0');
    expect(env.system.platform).toBeDefined();
    expect(env.system.arch).toBeDefined();
    expect(env.system.username).toBeDefined();
    expect(Array.isArray(env.sdks)).toBe(true);
  });
});

describe('环境迁移 — 快照导出与脚本生成', () => {
  it('exportEnvironment 生成 JSON 和 setup.sh', async () => {
    const res = await exportEnvironment({
      outputDir: TMP_DIR,
      outputPrefix: 'test-env',
      modules: ['sdks'],
    });

    expect(res.jsonPath).toBeDefined();
    expect(res.scriptPath).toBeDefined();
    expect(res.summary.totalItems).toBeGreaterThanOrEqual(0);

    const jsonContent = await readFile(res.jsonPath!, 'utf-8');
    const parsed = JSON.parse(jsonContent);
    expect(parsed.version).toBe('1.0.0');
    expect(parsed.system).toBeDefined();

    const scriptContent = await readFile(res.scriptPath!, 'utf-8');
    expect(scriptContent).toContain('#!/usr/bin/env bash');
    expect(scriptContent).toContain('devtoolkit 环境迁移脚本');
  });

  it('generateSetupScript 包含各包管理器安装指令', () => {
    const script = generateSetupScript(MOCK_SNAPSHOT);
    expect(script).toContain('brew install node git ripgrep jq');
    expect(script).toContain('brew install --cask visual-studio-code iterm2');
    expect(script).toContain('npm install -g typescript pnpm');
    expect(script).toContain('pip3 install requests==2.31.0 pytest==8.0.0');
    expect(script).toContain('code --install-extension dbaeumer.vscode-eslint');
    expect(script).toContain('git config --global user.name "Tester"');
    expect(script).toContain('SSH 私钥');
  });
});

describe('环境迁移 — 导入与 Diff 比对', () => {
  it('loadSnapshot 正确读取快照或抛错', async () => {
    const filePath = join(TMP_DIR, 'snapshot.json');
    await writeFile(filePath, JSON.stringify(MOCK_SNAPSHOT), 'utf-8');

    const loaded = loadSnapshot(filePath);
    expect(loaded.version).toBe('1.0.0');
    expect(loaded.brew?.formulae).toEqual(['node', 'git', 'ripgrep', 'jq']);

    expect(() => loadSnapshot(join(TMP_DIR, 'non-exists.json'))).toThrow(
      '不存在',
    );
  });

  it('importEnvironment dry-run 模式只生成命令', async () => {
    const res = await importEnvironment(MOCK_SNAPSHOT, { execute: false });
    expect(res.commands.length).toBeGreaterThan(0);
    expect(res.commands.some((c) => c.includes('brew install'))).toBe(true);
    expect(res.commands.some((c) => c.includes('npm install -g'))).toBe(true);
    expect(res.results.length).toBe(0); // dry-run 不实际执行

    const preview = formatImportPreview(res);
    expect(preview).toContain('dry-run 模式');
    expect(preview).toContain('brew install');
  });

  it('diffEnvironment 正确比对差异', async () => {
    const currentMachine: EnvSnapshot = {
      ...MOCK_SNAPSHOT,
      brew: {
        formulae: ['node', 'git'], // 缺失 ripgrep, jq
        casks: ['visual-studio-code', 'docker'], // 缺失 iterm2，多出 docker
      },
      npmGlobal: [
        { name: 'typescript', version: '5.2.0' }, // 版本不一致
      ],
      pipPackages: [],
      vscodeExtensions: [{ id: 'dbaeumer.vscode-eslint', version: '2.4.4' }],
    };

    const diff = await diffEnvironment(MOCK_SNAPSHOT, currentMachine);
    expect(diff.hasDifferences).toBe(true);
    expect(diff.brewFormulae.missing).toEqual(['ripgrep', 'jq']);
    expect(diff.brewCasks.missing).toEqual(['iterm2']);
    expect(diff.brewCasks.extra).toEqual(['docker']);
    expect(diff.npmGlobal.missing).toEqual(['pnpm']);
    expect(diff.npmGlobal.versionMismatch.length).toBe(1);
    expect(diff.npmGlobal.versionMismatch[0].name).toBe('typescript');
    expect(diff.vscodeExtensions.missing).toEqual(['esbenp.prettier-vscode']);

    const preview = formatDiffPreview(diff);
    expect(preview).toContain('缺失 Homebrew Formulae');
    expect(preview).toContain('缺失 npm 全局包');
    expect(preview).toContain('版本不一致');
  });

  it('diffEnvironment 当环境一致时返回 hasDifferences=false', async () => {
    const diff = await diffEnvironment(MOCK_SNAPSHOT, MOCK_SNAPSHOT);
    expect(diff.hasDifferences).toBe(false);
    expect(diff.summary.totalMissing).toBe(0);

    const preview = formatDiffPreview(diff);
    expect(preview).toContain('完全一致');
  });
});
