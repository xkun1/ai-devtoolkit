import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PipelineOptions, SkillResult } from './types/index.js';
import { loadDocuments, mergeDocuments } from './loader/index.js';
import { transformToSkill } from './transform/index.js';
import { formatResult } from './format/index.js';
import { injectSkillFrontmatter } from './format/frontmatter.js';
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  debug,
  success,
  info,
} from './utils/logger.js';

/** 核心管线：sources → load → merge → transform → format → output */
export async function runPipeline(
  sources: string | string[],
  options: PipelineOptions,
): Promise<SkillResult> {
  const sourceList = Array.isArray(sources) ? sources : [sources];

  // Step 1: 并发加载所有来源
  startSpinner(
    sourceList.length > 1
      ? `正在并发加载 ${sourceList.length} 个文档...`
      : '正在加载文档...',
  );
  let doc;
  try {
    const docs = await loadDocuments(sourceList);
    doc = mergeDocuments(docs);
    debug(`文档类型: ${doc.type}, 长度: ${doc.content.length} 字符`);
  } catch (err: any) {
    failSpinner(`加载失败: ${err.message}`);
    throw err;
  }
  succeedSpinner(
    `加载完成: ${doc.title || doc.source} (${doc.content.length} 字符)`,
  );

  if (doc.content.trim().length < 50) {
    throw new Error('文档内容过短（<50字符），可能加载失败或页面无正文内容');
  }

  // Step 2: LLM 提炼
  startSpinner(`正在用 ${options.llm.model} 提炼技能知识...`);
  let skillContent;
  try {
    skillContent = await transformToSkill(
      doc,
      options.llm,
      options.agentType,
      options.name,
    );
    debug(`LLM 输出长度: ${skillContent.length} 字符`);
  } catch (err: any) {
    failSpinner(`LLM 提炼失败: ${err.message}`);
    throw err;
  }
  succeedSpinner(`提炼完成 (${skillContent.length} 字符)`);

  // Step 3: Codex 技能注入 frontmatter（name + description）
  // 从原始文档内容提取 H1 作为 title 优先级最高，比文件名更有语义
  const docH1 = doc.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (options.agentType === 'codex') {
    skillContent = injectSkillFrontmatter(skillContent, {
      name: options.name,
      title: docH1 || doc.title,
      description: doc.meta?.description,
    });
  }

  // Step 4: 格式化 + 输出
  const result = formatResult(
    skillContent,
    options.agentType,
    options.outputPath,
  );

  if (options.stdout) {
    // stdout 模式：纯内容输出，便于管道（日志已在 stderr）
    process.stdout.write(result.content);
    return result;
  }

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
