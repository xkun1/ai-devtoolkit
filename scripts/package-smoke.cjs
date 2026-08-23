const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const tempDir = mkdtempSync(join(tmpdir(), 'devtoolkit-package-smoke-'));
const packDir = join(tempDir, 'pack');
const consumerDir = join(tempDir, 'consumer');
mkdirSync(packDir);
mkdirSync(consumerDir);

try {
  const packed = JSON.parse(
    execFileSync(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      [
        'pack',
        '--json',
        '--ignore-scripts',
        '--pack-destination',
        packDir,
        '--cache',
        join(tmpdir(), 'devtoolkit-package-smoke-cache'),
      ],
      { cwd: root, encoding: 'utf-8' },
    ),
  )[0];

  const paths = new Set(packed.files.map((file) => file.path));
  const packageName = packed.name;
  assert(
    typeof packageName === 'string' && packageName.length > 0,
    'npm pack 未返回有效包名',
  );
  assert(
    packed.size < 750 * 1024,
    `发布包压缩体积过大：${packed.size} bytes`,
  );
  assert(
    packed.unpackedSize < 3 * 1024 * 1024,
    `发布包解压体积过大：${packed.unpackedSize} bytes`,
  );
  for (const required of [
    'bin/cli.js',
    'dist/cli.js',
    'dist/index.js',
    'dist/index.mjs',
    'dist/index.d.ts',
    'dist/search.js',
    'dist/search.mjs',
    'dist/security.js',
    'dist/security.mjs',
    '.env.example',
  ]) {
    assert(paths.has(required), `发布包缺少 ${required}`);
  }

  writeFileSync(
    join(consumerDir, 'package.json'),
    JSON.stringify({ name: 'package-smoke-consumer', private: true }),
  );
  execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'install',
      join(packDir, packed.filename),
      '--ignore-scripts',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      '--prefer-offline',
      '--cache',
      join(tmpdir(), 'devtoolkit-package-smoke-cache'),
    ],
    { cwd: consumerDir, stdio: 'pipe' },
  );
  const installedRoot = join(
    consumerDir,
    'node_modules',
    ...packageName.split('/'),
  );

  const cjsScript = join(consumerDir, 'smoke.cjs');
  writeFileSync(
    cjsScript,
    `const { devtoolkit } = require(${JSON.stringify(packageName)});\n` +
      `const { devtoolkit: legacyDevtoolkit } = require(${JSON.stringify(`${packageName}/lib`)});\n` +
      `const { searchCode } = require(${JSON.stringify(`${packageName}/search`)});\n` +
      `const { redactContent } = require(${JSON.stringify(`${packageName}/security`)});\n` +
      `if ([devtoolkit, legacyDevtoolkit, searchCode, redactContent].some((item) => typeof item !== 'function')) process.exit(1);\n`,
  );
  execFileSync(process.execPath, [cjsScript], {
    cwd: consumerDir,
    stdio: 'inherit',
  });

  const esmScript = join(consumerDir, 'smoke.mjs');
  writeFileSync(
    esmScript,
    `import { devtoolkit } from ${JSON.stringify(packageName)};\n` +
      `import { devtoolkit as legacyDevtoolkit } from ${JSON.stringify(`${packageName}/lib`)};\n` +
      `import { searchCode } from ${JSON.stringify(`${packageName}/search`)};\n` +
      `import { redactContent } from ${JSON.stringify(`${packageName}/security`)};\n` +
      `if ([devtoolkit, legacyDevtoolkit, searchCode, redactContent].some((item) => typeof item !== 'function')) process.exit(1);\n`,
  );
  execFileSync(process.execPath, [esmScript], {
    cwd: consumerDir,
    stdio: 'inherit',
  });

  const declaration = readFileSync(
    join(installedRoot, 'dist/index.d.ts'),
    'utf-8',
  );
  assert(!/^export\s*\{\s*\}\s*$/m.test(declaration), '根类型声明为空');

  const help = execFileSync(
    process.execPath,
    [join(installedRoot, 'bin/cli.js'), '--help'],
    { encoding: 'utf-8' },
  );
  for (const option of [
    '--watch',
    '--local-model',
    '--llm-timeout',
    '--max-output-tokens',
    '--search-mode',
    '--sensitive-policy',
  ]) {
    assert(help.includes(option), `CLI 缺少 ${option}`);
  }
  for (const agent of [
    'codex',
    'cursor',
    'claude',
    'windsurf',
    'copilot',
    'gemini',
    'aider',
  ]) {
    assert(help.includes(agent), `CLI 帮助缺少 Agent ${agent}`);
  }

  console.log('发布包真实安装 smoke test 通过');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
