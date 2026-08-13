/**
 * 编程式 API 示例 — 将 devtoolkit 作为库使用
 *
 * 运行：npx tsx examples/programmatic-api.ts
 */
import { devtoolkit } from '../src/lib.js';

async function main() {
  const result = await devtoolkit('./examples/sample-doc.md', {
    agentType: 'codex',
    llm: {
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-xxx',
      baseURL: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    },
    name: 'my-custom-skill',
    dryRun: true,
  });

  console.log('--- 生成结果 ---');
  console.log(result.content);
  console.log('---');
  console.log('建议路径:', result.suggestedPath);
}

main().catch(console.error);
