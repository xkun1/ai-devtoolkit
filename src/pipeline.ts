import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PipelineOptions, SkillResult } from './types/index.js';
import { loadDocument } from './loader/index.js';
import { transformToSkill } from './transform/index.js';
import { formatResult } from './format/index.js';
import { startSpinner, succeedSpinner, failSpinner, debug, success, info } from './utils/logger.js';

/** 核心管线：source → load → transform → format → write */
export async function runPipeline(
  source: string,
  options: PipelineOptions,
): Promise<SkillResult> {
  // Step 1: 加载
  startSpinner('正在加载文档...');
  let doc;
  try {
    doc = await loadDocument(source);
    debug(`文档类型: ${doc.type}, 长度: ${doc.content.length} 字符`);
  } catch (err: any) {
    failSpinner(`加载失败: ${err.message}`);
    throw err;
  }
  succeedSpinner(`加载完成: ${doc.title || doc.source} (${doc.content.length} 字符)`);

  if (doc.content.trim().length < 50) {
    throw new Error('文档内容过短（<50字符），可能加载失败或页面无正文内容');
  }

  // Step 2: LLM 提炼
  startSpinner(`正在用 ${options.llm.model} 提炼技能知识...`);
  let skillContent;
  try {
    skillContent = await transformToSkill(doc, options.llm, options.agentType);
    debug(`LLM 输出长度: ${skillContent.length} 字符`);
  } catch (err: any) {
    failSpinner(`LLM 提炼失败: ${err.message}`);
    throw err;
  }
  succeedSpinner(`提炼完成 (${skillContent.length} 字符)`);

  // Step 3: 格式化
  const result = formatResult(skillContent, options.agentType, options.outputPath);

  // Step 4: 写入文件
  await writeFileWithDir(result.suggestedPath, result.content);
  success(`已生成: ${result.suggestedPath}`);

  info('');
  info(`  🎯 Agent: ${options.agentType}`);
  info(`  📄 文件: ${result.suggestedPath}`);
  info(`  📏 大小: ${result.content.length} 字符`);
  info('');

  return result;
}

async function writeFileWithDir(path: string, content: string): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, content, 'utf-8');
}
