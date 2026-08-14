import { access } from 'node:fs/promises';
import type { PipelineOptions, SkillResult } from './types/index.js';
import {
  loadDocuments,
  mergeDocuments,
  expandSources,
  isDirectory,
} from './loader/index.js';
import { crawlSite } from './loader/crawler.js';
import { transformDocumentToSkill } from './transform/index.js';
import { getTemplate } from './templates/index.js';
import {
  buildGenerationFingerprint,
  createCacheKey,
  getCachePath,
  loadCachedResult,
  saveGeneratedResult,
} from './utils/hash.js';
import { buildArtifacts, resolvePrimaryPath } from './format/artifacts.js';
import { PROMPT_VERSION } from './transform/prompts.js';
import { assertValidSkillResult } from './quality/validate.js';
import { writeFileAtomic } from './utils/atomic-write.js';
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

  // ── 目录批量模式 ──
  const hadDir = await Promise.all(sourceList.map((s) => isDirectory(s)));
  const hasDirectory = hadDir.some(Boolean);

  if (hasDirectory) {
    const { files } = await expandSources(sourceList, {
      maxDepth: options.dirMaxDepth,
    });
    if (files.length === 0) {
      throw new Error('目录中未找到受支持的文档文件');
    }

    // --merge 模式：展开目录后合并为一个技能包
    if (options.mergeDir) {
      info(`📂 目录展开: 找到 ${files.length} 个文件，合并为一个技能包`);
      return runPipelineSingle(files, options);
    }

    // 批量模式：逐文件生成独立技能包
    info('╔══════════════════════════════════════╗');
    info('║   📂 批量目录模式 — 逐文件生成        ║');
    info('╚══════════════════════════════════════╝');
    info(`  📁 共 ${files.length} 个文档待处理`);
    info('');

    const results: SkillResult[] = [];
    for (let i = 0; i < files.length; i++) {
      info(`  [${i + 1}/${files.length}] 处理: ${files[i]}`);
      const result = await runPipelineSingle(files[i], {
        ...options,
        force: true,
        mergeDir: false,
      });
      results.push(result);
      info('');
    }

    info('  ─────────────────────────────────');
    info(`  ✅ 批量完成: ${results.length} 个技能包已生成`);
    info('  ─────────────────────────────────');

    return results[results.length - 1];
  }

  return runPipelineSingle(sourceList, options);
}

/** 单次管线执行（不含目录批量逻辑） */
async function runPipelineSingle(
  sources: string | string[],
  options: PipelineOptions,
): Promise<SkillResult> {
  const sourceList = Array.isArray(sources) ? sources : [sources];

  // Step 1: 加载（crawl 模式或常规加载）
  let doc;
  // ── 预加载内容模式（Web UI 文件上传）──
  if (options.preloaded?.content || options.preloaded?.binaryContent) {
    const pl = options.preloaded;
    const fileName = pl.fileName || 'uploaded';
    let processed = pl.content || '';
    let title = fileName.replace(/\.[^.]+$/, '');
    let meta: Record<string, string> = {};
    let docType: 'pdf' | 'html' | 'text' = 'text';

    // ── 二进制文件：PDF / DOCX ──
    if (pl.binaryContent) {
      const buffer = Buffer.from(pl.binaryContent, 'base64');
      const ext = fileName.toLowerCase();

      if (/\.pdf$/.test(ext) || pl.mimeType === 'application/pdf') {
        // PDF 提取
        docType = 'pdf';
        try {
          const { extractPdfFromBuffer } = await import('./loader/pdf.js');
          const result = await extractPdfFromBuffer(buffer, fileName);
          processed = result.content;
          title = result.title || title;
          meta = { format: 'pdf' };
        } catch (err: any) {
          // 兼容'假 PDF'：文件名是 .pdf 但内容实际是 HTML（某些网页'另存为 PDF'产物）
          const rawText = buffer.toString('utf-8');
          if (/^\s*<!doctype|<html/i.test(rawText)) {
            docType = 'html';
            try {
              const { extractFromHtml } =
                await import('./loader/readability.js');
              const result = await extractFromHtml(rawText);
              processed = result.content;
              title = result.title || title;
              meta = { format: 'html-in-pdf' };
            } catch {
              processed = rawText;
              meta = { format: 'html-in-pdf' };
            }
          } else {
            throw new Error(
              'PDF 解析失败: ' +
                err.message +
                '（请确认文件是有效的 PDF 格式）',
              { cause: err },
            );
          }
        }
      } else if (/\.docx?$/.test(ext) || pl.mimeType?.includes('word')) {
        // DOCX 提取
        docType = 'text';
        try {
          const { extractDocxFromBuffer } = await import('./loader/doc.js');
          const result = await extractDocxFromBuffer(buffer, fileName);
          processed = result.content;
          title = result.title || title;
          meta = { format: 'docx' };
        } catch (err: any) {
          throw new Error(
            'DOCX 解析失败: ' +
              err.message +
              '（请确认文件是有效的 .docx 格式）',
            { cause: err },
          );
        }
      } else {
        // 其他二进制类型，尝试当文本读
        processed = buffer.toString('utf-8');
      }
    } else {
      // ── 文本文件：Markdown / HTML / TXT ──
      const isHtml = /^\s*<!doctype|<html/i.test(processed);

      if (isHtml) {
        docType = 'html';
        try {
          const { extractFromHtml } = await import('./loader/readability.js');
          const result = await extractFromHtml(processed);
          processed = result.content;
          title = result.title || title;
          meta = result.meta;
        } catch {
          // 提取失败就用原文
        }
      } else {
        try {
          const { isOpenApiSpec, parseOpenApiSpec, renderOpenApiToMarkdown } =
            await import('./loader/openapi.js');
          if (isOpenApiSpec(processed, fileName)) {
            const parsed = parseOpenApiSpec(processed);
            processed = renderOpenApiToMarkdown(parsed);
            title = parsed.title || title;
            meta = {
              format: 'openapi',
              specType: parsed.specType,
              specVersion: parsed.version,
              endpointsCount: String(parsed.endpoints.length),
            };
          }
        } catch {
          // 保持原文
        }
      }
    }

    // SPA 空壳检测
    checkSpaShell(processed, fileName);

    doc = {
      source: pl.source || fileName,
      type: docType,
      content: processed,
      title,
      meta,
    };
  } else if (
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

  // SPA 空壳检测（URL 加载时）
  if (doc.type === 'url') {
    checkSpaShell(doc.content, doc.source);
  }

  if (doc.content.trim().length < 50) {
    throw new Error('文档内容过短（<50字符），可能加载失败或页面无正文内容');
  }

  const outputMode = options.outputMode ?? 'modern';
  const expectedPrimaryPath = resolvePrimaryPath(
    options.agentType,
    doc,
    options.name,
    options.outputPath,
    outputMode,
  );
  const cachePath = getCachePath(expectedPrimaryPath);
  const cacheKey = createCacheKey(doc.source, expectedPrimaryPath);
  const fingerprint = buildGenerationFingerprint({
    source: doc.source,
    content: doc.content,
    agentType: options.agentType,
    template: options.template,
    model: options.llm.model,
    baseURL: options.llm.baseURL,
    temperature: options.llm.temperature,
    maxOutputTokens: options.llm.maxOutputTokens,
    name: options.name,
    outputMode,
    promptVersion: PROMPT_VERSION,
  });

  // Step 2: LLM 提炼
  // 增量更新检查：完整指纹命中且真实产物未被改动时直接复用。
  if (options.incremental) {
    const cached = loadCachedResult(
      cachePath,
      cacheKey,
      fingerprint,
      options.agentType,
    );
    if (cached) {
      cached.quality = assertValidSkillResult(cached);
      success(`缓存命中，已复用 ${cached.artifacts?.length ?? 1} 个真实产物`);
      if (options.stdout) process.stdout.write(cached.content);
      return cached;
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

  let transformed;
  try {
    transformed = await transformDocumentToSkill(
      doc,
      options.llm,
      options.agentType,
      options.name,
      template,
    );
    debug(`LLM 输出长度: ${transformed.content.length} 字符`);
  } catch (err: any) {
    failSpinner(`LLM 提炼失败: ${err.message}`);
    throw err;
  }
  succeedSpinner(
    `提炼完成 (${transformed.content.length} 字符，${transformed.stats.sourceChunks} 个源分块 / ${transformed.stats.llmCalls} 次 LLM 调用)`,
  );

  // Step 3: 生成各 Agent 当前推荐的文件结构。
  const result = buildArtifacts({
    agentType: options.agentType,
    content: transformed.content,
    doc,
    name: options.name,
    outputPath: options.outputPath,
    outputMode,
  });
  result.stats = { ...transformed.stats, cacheHit: false };
  result.quality = assertValidSkillResult(result);

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
    info(`  📦 文件:  ${result.artifacts?.length ?? 1} 个`);
    info(`  ✅ 质量:  ${result.quality.score}/100`);
    info('  ─────────────────────────────────');
    info('');
    info(result.content);
    info('');
    return result;
  }

  const artifacts = result.artifacts ?? [
    {
      path: result.suggestedPath,
      content: result.content,
      kind: 'primary' as const,
    },
  ];

  // 覆盖保护：任一目标文件已存在且未指定 --force 时拒绝覆盖。
  if (!options.force) {
    for (const artifact of artifacts) {
      try {
        await access(artifact.path);
        throw new Error(
          `文件已存在: ${artifact.path}\n  使用 --force 覆盖，或 --out 指定其他路径`,
        );
      } catch (err: any) {
        if (err.message?.startsWith('文件已存在')) throw err;
        if (err.code !== 'ENOENT') throw err;
      }
    }
  }

  for (const artifact of artifacts) {
    await writeFileAtomic(artifact.path, artifact.content);
    success(`已生成: ${artifact.path}`);
  }
  // 所有产物写完后再原子更新缓存。
  if (options.incremental) {
    saveGeneratedResult(cachePath, cacheKey, fingerprint, result);
  }

  info('');
  info(`  🎯 Agent: ${options.agentType}`);
  info(`  📦 文件: ${artifacts.length} 个`);
  info(`  ✅ 质量: ${result.quality.score}/100`);
  info('');

  return result;
}

/**
 * 检测 SPA 空壳页面：内容几乎为空但有大量 HTML 骨架
 * 典型特征：<div id="root"> / <div id="app"> 且正文极少
 *
 * 这种页面内容是 JS 动态渲染的，fetch 拿不到实际内容。
 * 检测到后发出警告（不阻止流程，因为有些页面确实内容少）
 */
function checkSpaShell(content: string, source: string): void {
  const stripped = content.replace(/<[^>]+>/g, '').trim();
  const hasRootDiv = /<div\s+id=["']?(root|app)["']?/i.test(content);
  const hasScriptBundle = /\/assets\/.+\.js|src=.*\.js/i.test(content);
  const textLength = stripped.length;

  // SPA 空壳特征：有 root/app div + JS bundle 但纯文字极少
  if (hasRootDiv && hasScriptBundle && textLength < 500) {
    warn(
      `⚠️ 检测到 SPA 动态页面（${source}），内容由 JavaScript 渲染，fetch 无法获取实际内容。\n` +
        `   建议：\n` +
        `   1. 用浏览器打开页面，复制渲染后的内容保存为 .md/.txt 再上传\n` +
        `   2. 或寻找该文档的 Markdown/PDF 原始版本\n` +
        `   3. 当前生成结果可能不完整`,
    );
  }
}
