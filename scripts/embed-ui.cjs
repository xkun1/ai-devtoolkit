const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const sourcePath = join(root, 'src', 'server', 'ui.html');
const outputPath = join(root, 'src', 'server', 'ui.generated.ts');
const source = readFileSync(sourcePath, 'utf-8');
const generated =
  '/** 此文件由 scripts/embed-ui.cjs 生成，请修改 ui.html。 */\n' +
  `export const EMBEDDED_WEB_UI_HTML =\n  ${JSON.stringify(source)};\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outputPath, 'utf-8');
  } catch {
    // 统一在下面输出错误。
  }
  if (current !== generated) {
    console.error('Web UI 内嵌文件已过期，请运行 npm run generate:ui');
    process.exitCode = 1;
  }
} else {
  writeFileSync(outputPath, generated);
}
