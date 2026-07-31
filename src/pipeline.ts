import { writeFile, mkdir, access } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PipelineOptions, SkillResult } from './types/index.js';
import { loadDocuments, mergeDocuments } from './loader/index.js';
import { crawlSite } from './loader/crawler.js';
import { transformToSkill } from './transform/index.js';
import { getTemplate } from './templates/index.js';
import { getCachePath, needsUpdate, markGenerated } from './utils/hash.js';
import { formatResult } from './format/index.js';
import { injectSkillFrontmatter } from './format/frontmatter.js';
import {
  startSpinner,
  succeedSpinner,
  failSpinner,
  debug,
  success,
  warn,
  info,
} from './utils/logger.js';
import { estimateTokens, estimateCost, formatCost } from './utils/token.js';

/** 核心管线：sources → load → merge → transform → format → output */
export async function runPipeline(
  sources: string | string[],
  options: PipelineOptions,
): Promise<SkillResult> {
  const sourceList = Array.isArray(sources) ? sources : [sources];

  // Step 1: 加载（crawl 模式或常规加载）
  let doc;
  if (
    options.crawl &&
    sourceList.length === 1 &&
    /^https?:\/\//i.test(sourceList[0])
  ) {
    // ── 爬取模式 ──
    startSpinner(
      `正在爬取文档站点（深度 ${options.crawlDepth ?? 2}，最多 ${options.crawlPages ?? 10} 页）...`,
    );
    try {
      doc = await crawlSite(sourceList[0], {
        maxDepth: options.crawlDepth,
        maxPages: options.crawlPages,
      });
      debug(
        `爬取完成: ${doc.meta?.crawledPages} 页, ${doc.content.length} 字符`,
      );
    } catch (err: any) {
      failSpinner(`爬取失败: ${err.message}`);
      throw err;
    }
    succeedSpinner(
      `爬取完成: ${doc.meta?.crawledPages} 页 (${doc.content.length} 字符)`,
    );
  } else {
    // ── 常规加载 ──
    startSpinner(
      sourceList.length > 1
        ? `正在并发加载 ${sourceList.length} 个文档...`
        : '正在加载文档...',
    );
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
  }

  if (doc.content.trim().length < 50) {
    throw new Error('文档内容过短（<50字符），可能加载失败或页面无正文内容');
  }

  // Step 2: LLM 提炼
  // 增量更新检查：文档未变更时跳过 LLM 调用
  if (options.incremental) {
    const defaultOut =
      options.agentType === 'codex'
        ? './SKILL.md'
        : options.agentType === 'cursor'
          ? './.cursorrules'
          : './CLAUDE.md';
    const outPath = options.outputPath || defaultOut;
    const cachePath = getCachePath(outPath);
    const shouldUpdate = needsUpdate(
      cachePath,
      doc.source,
      doc.content,
      options.agentType,
      options.template,
    );
    if (!shouldUpdate) {
      success('文档未变更，跳过生成（使用 --force 强制重新生成）');
      return formatResult(
        '文档未变更，已跳过。',
        options.agentType,
        options.outputPath,
      );
    }
  }

  const template = options.template ? getTemplate(options.template) : undefined;
  if (options.template && !template) {
    warn(`未知模板: ${options.template}，使用默认模板`);
  }
  startSpinner(`正在用 ${options.llm.model} 提炼技能知识...`);

  // Token 预估（让用户了解成本）
  const promptText = `${doc.title}\n${doc.content}`;
  const inputTokens = estimateTokens(promptText);
  const estOutputTokens = Math.min(inputTokens, 2000); // 技能包通常比原文短
  const cost = estimateCost(inputTokens, estOutputTokens, options.llm.model);
  if (cost) {
    info(
      `  💰 预估: ~${inputTokens} 输入 tokens, 费用 ~${formatCost(cost.total)}`,
    );
  } else {
    info(`  📊 预估: ~${inputTokens} 输入 tokens`);
  }

  let skillContent;
  try {
    skillContent = await transformToSkill(
      doc,
      options.llm,
      options.agentType,
      options.name,
      template,
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

  // dry-run 模式：预览结果，不写文件
  if (options.dryRun) {
    info('');
    info('  ───── 📋 预览结果 (dry-run) ─────');
    info(`  🎯 Agent: ${options.agentType}`);
    info(`  📄 目标:  ${result.suggestedPath}`);
    info(`  📏 大小:  ${result.content.length} 字符`);
    info('  ─────────────────────────────────');
    info('');
    info(result.content);
    info('');
    return result;
  }

  // 覆盖保护：文件已存在且未指定 --force 时拒绝覆盖
  if (!options.force) {
    try {
      await access(result.suggestedPath);
      // 文件存在
      throw new Error(
        `文件已存在: ${result.suggestedPath}\n  使用 --force 覆盖，或 --out 指定其他路径`,
      );
    } catch (err: any) {
      // ENOENT = 文件不存在，正常继续
      if (err.message?.startsWith('文件已存在')) throw err;
      if (err.code !== 'ENOENT') throw err;
    }
  }

  await writeFileWithDir(result.suggestedPath, result.content);
  success(`已生成: ${result.suggestedPath}`);
  // 增量更新：记录 hash
  if (options.incremental) {
    const cachePath = getCachePath(result.suggestedPath);
    markGenerated(
      cachePath,
      doc.source,
      doc.content,
      options.agentType,
      options.template,
    );
  }

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
