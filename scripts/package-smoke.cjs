const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const root = join(__dirname, '..');
const packed = JSON.parse(
  execFileSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    [
      'pack',
      '--dry-run',
      '--json',
      '--ignore-scripts',
      '--cache',
      join(tmpdir(), 'devtoolkit-package-smoke-cache'),
    ],
    { cwd: root, encoding: 'utf-8' },
  ),
)[0];

const paths = new Set(packed.files.map((file) => file.path));
for (const required of [
  'bin/cli.js',
  'dist/cli.js',
  'dist/index.js',
  'dist/index.mjs',
  'dist/index.d.ts',
  '.env.example',
]) {
  assert(paths.has(required), `发布包缺少 ${required}`);
}

const cjs = require(root);
assert.equal(typeof cjs.devtoolkit, 'function', 'CJS 根入口未导出 devtoolkit');

const tempDir = mkdtempSync(join(tmpdir(), 'devtoolkit-esm-smoke-'));
const esmScript = join(tempDir, 'smoke.mjs');
writeFileSync(
  esmScript,
  `import { devtoolkit } from ${JSON.stringify(join(root, 'dist/index.mjs'))};\n` +
    `if (typeof devtoolkit !== 'function') process.exit(1);\n`,
);
execFileSync(process.execPath, [esmScript], { stdio: 'inherit' });

const declaration = readFileSync(join(root, 'dist/index.d.ts'), 'utf-8');
assert(!/^export\s*\{\s*\}\s*$/m.test(declaration), '根类型声明为空');

const help = execFileSync(process.execPath, [join(root, 'bin/cli.js'), '--help'], {
  encoding: 'utf-8',
});
assert(help.includes('--watch'), 'CLI 缺少 --watch');
assert(help.includes('--local-model'), 'CLI 缺少 --local-model');
assert(help.includes('--llm-timeout'), 'CLI 缺少 --llm-timeout');
assert(help.includes('--max-output-tokens'), 'CLI 缺少 --max-output-tokens');

console.log('发布包 smoke test 通过');
