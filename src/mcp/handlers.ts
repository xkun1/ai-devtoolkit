/** MCP 工具执行与参数校验。 */
import { readFile, stat } from 'node:fs/promises';
import type { AgentType, SkillResult } from '../types/index.js';
import { runPipeline } from '../pipeline.js';
import {
  resolveModel,
  isLocalModel,
  resolveLocalModelName,
} from '../models.js';
import {
  initCodeIndex,
  searchProjectCode,
  explainResults,
} from '../search/index.js';
import {
  exportEnvironment,
  diffEnvironment,
  loadSnapshot,
  formatDiffPreview,
} from '../env/index.js';
import {
  convertFile,
  convertRule,
  parseRule,
  syncProjectRules,
} from '../convert/index.js';
import { runSkillEval, formatEvalReportMarkdown } from '../eval/index.js';
import { writeFileAtomic } from '../utils/atomic-write.js';
import { isValidAgentType } from '../format/index.js';
import { isValidTemplate } from '../templates/index.js';
import {
  ResourceLimitError,
  isAbortError,
  throwIfAborted,
} from '../utils/abort.js';
import type { McpToolContext } from './types.js';

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<string | Record<string, unknown>> {
  throwIfAborted(context.signal, `MCP 工具 ${name}`);
  switch (name) {
    case 'generate_skill':
      return await handleGenerateSkill(args, context);
    case 'scan_directory':
      return await handleScanDirectory(args, context);
    case 'scan_code':
      return await handleScanCode(args);
    case 'search_code':
      return await handleSearchCode(args, context);
    case 'convert_rule':
      return await handleConvertRule(args);
    case 'sync_rules':
      return await handleSyncRules(args);
    case 'export_env':
      return await handleExportEnv(args);
    case 'diff_env':
      return await handleDiffEnv(args);
    case 'eval_skill':
      return await handleEvalSkill(args, context);
    default:
      throw new Error(`未知工具: ${name}`);
  }
}

async function handleGenerateSkill(
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<Record<string, unknown>> {
  const sources = args.sources as string[];
  if (
    !Array.isArray(sources) ||
    sources.length === 0 ||
    sources.length > 100 ||
    sources.some(
      (source) =>
        typeof source !== 'string' || !source.trim() || source.length > 10_000,
    )
  ) {
    throw new Error('sources 参数必须是非空数组');
  }

  const agentType = (args.agentType as AgentType) || 'codex';
  const skillName = args.name as string | undefined;
  const template = args.template as string | undefined;
  const force = args.force as boolean;
  const dryRun = args.dryRun as boolean;
  const outputPath = args.outputPath as string | undefined;
  if (!isValidAgentType(agentType)) {
    throw new Error(`无效的 Agent 类型: ${String(agentType)}`);
  }
  if (template && !isValidTemplate(template)) {
    throw new Error(`未知模板: ${template}`);
  }
  validateOptionalStrings(args, [
    'name',
    'template',
    'model',
    'baseUrl',
    'apiKey',
    'localModelName',
    'outputPath',
  ]);
  validateOptionalBooleans(args, ['force', 'dryRun']);

  const model =
    (args.model as string) ||
    context.defaults.model ||
    process.env.DOC2SKILL_MODEL ||
    'deepseek-chat';
  const apiKey =
    (args.apiKey as string) ||
    context.defaults.apiKey ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const baseURL =
    (args.baseUrl as string) ||
    context.defaults.baseURL ||
    process.env.DOC2SKILL_BASE_URL ||
    undefined;
  const localModelName =
    (args.localModelName as string) || context.defaults.localModelName;

  const timeoutMs = normalizeOptionalInteger(
    args.timeoutMs,
    1_000,
    10 * 60_000,
    'timeoutMs',
  );
  const maxOutputTokens =
    normalizeOptionalInteger(
      args.maxOutputTokens,
      1,
      131_072,
      'maxOutputTokens',
    ) ?? context.maxOutputTokens;
  const batchConcurrency = normalizeOptionalInteger(
    args.batchConcurrency,
    1,
    8,
    'batchConcurrency',
  );
  const maxBatchFiles = normalizeOptionalInteger(
    args.maxBatchFiles,
    1,
    100,
    'maxBatchFiles',
  );

  if (!isLocalModel(model) && !apiKey) {
    throw new Error(
      '缺少 API Key。请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量。',
    );
  }
  validateCustomLocalModel(model, baseURL, localModelName);

  const llmConfig = {
    ...resolveModel(model, {
      apiKey,
      baseUrl: baseURL,
      localModelName,
    }),
    maxOutputTokens,
  };

  const result: SkillResult = await runPipeline(sources, {
    agentType,
    llm: llmConfig,
    name: skillName,
    template,
    outputPath,
    force: force ?? false,
    dryRun: dryRun ?? false,
    stdout: false,
    outputMode: 'modern',
    signal: context.signal,
    llmTimeoutMs: timeoutMs ?? context.llmTimeoutMs,
    maxOutputChars: context.maxOutputChars,
    batchConcurrency,
    maxBatchFiles,
  });

  return {
    success: true,
    agentType: result.agentType,
    content: result.content,
    suggestedPath: result.suggestedPath,
    artifacts: result.artifacts?.map((a) => ({
      path: a.path,
      kind: a.kind,
      size: a.content.length,
    })),
    stats: result.stats,
    quality: result.quality
      ? {
          score: result.quality.score,
          passed: result.quality.passed,
        }
      : undefined,
  };
}

async function handleScanDirectory(
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<Record<string, unknown>> {
  const { scanDirectory } = await import('../loader/directory.js');
  const dirPath = args.directory;
  if (typeof dirPath !== 'string' || !dirPath.trim()) {
    throw new Error('directory 参数必填');
  }

  const maxDepth = (args.maxDepth as number) ?? 5;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 1 || maxDepth > 20) {
    throw new Error('maxDepth 必须是 1-20 的整数');
  }
  const maxFiles = (args.maxFiles as number) ?? 1_000;
  if (!Number.isSafeInteger(maxFiles) || maxFiles < 1 || maxFiles > 10_000) {
    throw new Error('maxFiles 必须是 1-10000 的整数');
  }
  const files = await scanDirectory(dirPath, {
    maxDepth,
    maxFiles,
    signal: context.signal,
  });

  return {
    directory: dirPath,
    fileCount: files.length,
    files,
  };
}

async function handleScanCode(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  validateOptionalStrings(args, ['directory']);
  const directory = (args.directory as string) || process.cwd();
  const index = await initCodeIndex({ root: directory });

  return {
    success: true,
    directory,
    stats: index.stats,
  };
}

async function handleSearchCode(
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<Record<string, unknown>> {
  const query = args.query;
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query 参数必填');
  }
  if (query.length > 10_000) throw new Error('query 参数过长');

  validateOptionalStrings(args, ['directory']);
  validateOptionalBooleans(args, ['explain']);
  const directory = (args.directory as string) || process.cwd();
  const limit = (args.limit as number) ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('limit 必须是 1-100 的整数');
  }
  const useExplain = (args.explain as boolean) ?? true;

  const { results, index } = await searchProjectCode(
    query,
    { limit },
    directory,
  );
  throwIfAborted(context.signal, 'MCP 代码搜索');

  let explanation: string | undefined;
  if (useExplain && results.length > 0) {
    const model = context.defaults.model || 'deepseek-chat';
    const apiKey =
      context.defaults.apiKey ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      '';
    const baseURL = context.defaults.baseURL;
    const localModelName = context.defaults.localModelName;

    if (isLocalModel(model) || apiKey) {
      try {
        const llmConfig = {
          ...resolveModel(model, {
            apiKey,
            baseUrl: baseURL,
            localModelName,
          }),
          maxOutputTokens: context.maxOutputTokens,
        };
        explanation = await explainResults({
          llm: llmConfig,
          query,
          results,
          projectRoot: index.projectRoot,
          signal: context.signal,
          timeoutMs: context.llmTimeoutMs,
          maxOutputChars: context.maxOutputChars,
        });
      } catch (error) {
        if (
          context.signal.aborted ||
          isAbortError(error) ||
          error instanceof ResourceLimitError
        ) {
          throw error;
        }
        // ignore LLM failure
      }
    }
  }

  return {
    query,
    totalMatches: results.length,
    explanation,
    results: results.map((r) => ({
      file: r.chunk.file,
      language: r.chunk.language,
      lines: `${r.chunk.startLine}-${r.chunk.endLine}`,
      score: Number(r.score.toFixed(2)),
      matchedSymbols: r.matchedSymbols,
      matchedKeywords: r.matchedKeywords,
      codePreview: r.chunk.content.split('\n').slice(0, 20).join('\n'),
    })),
  };
}

async function handleConvertRule(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const toAgent = args.to as AgentType;
  const rulePath = args.rulePath as string | undefined;
  const ruleContent = args.ruleContent as string | undefined;
  const name = args.name as string | undefined;
  const outputDir = args.outputDir as string | undefined;
  const shouldWrite = args.write === true;
  if (!isValidAgentType(String(toAgent))) {
    throw new Error(`无效的目标 Agent 类型: ${String(toAgent)}`);
  }
  validateOptionalStrings(args, ['rulePath', 'name', 'outputDir']);
  validateOptionalBooleans(args, ['write']);
  if (
    ruleContent !== undefined &&
    (typeof ruleContent !== 'string' || ruleContent.length > 1024 * 1024)
  ) {
    throw new Error('ruleContent 参数必须是 1 MiB 以内的字符串');
  }
  if (rulePath && ruleContent) {
    throw new Error('rulePath 与 ruleContent 只能提供一个');
  }

  if (rulePath) {
    const res = await convertFile(rulePath, toAgent, {
      name,
      outputDir,
      write: shouldWrite,
    });
    return {
      success: true,
      from: res.from,
      to: res.to,
      artifacts: res.artifacts,
    };
  }

  if (ruleContent) {
    const parsed = parseRule(ruleContent);
    const res = convertRule(parsed, { to: toAgent, name, outputDir });
    if (shouldWrite) {
      for (const artifact of res.artifacts) {
        await writeFileAtomic(artifact.path, artifact.content);
      }
    }
    return {
      success: true,
      from: res.from,
      to: res.to,
      artifacts: res.artifacts,
    };
  }

  throw new Error('必须提供 rulePath 或 ruleContent 参数');
}

async function handleSyncRules(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const projectRoot = (args.projectRoot as string) || process.cwd();
  const fromAgent = args.from as AgentType | 'auto' | undefined;
  const toAgents = args.to as AgentType[] | undefined;
  const dryRun = args.dryRun !== false;
  validateOptionalStrings(args, ['projectRoot', 'from']);
  validateOptionalBooleans(args, ['dryRun']);
  if (
    fromAgent !== undefined &&
    !['auto', 'codex', 'cursor', 'claude'].includes(String(fromAgent))
  ) {
    throw new Error(`无效的同步源 Agent: ${String(fromAgent)}`);
  }
  if (
    toAgents !== undefined &&
    (!Array.isArray(toAgents) ||
      toAgents.length > 3 ||
      toAgents.some((agent) => !isValidAgentType(String(agent))))
  ) {
    throw new Error('无效的同步目标 Agent 列表');
  }

  const res = await syncProjectRules({
    projectRoot,
    from: fromAgent,
    to: toAgents,
    dryRun,
  });

  return {
    success: true,
    dryRun,
    summary: res.summary,
    operations: res.operations,
  };
}

async function handleExportEnv(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const outputDir = (args.outputDir as string) || process.cwd();
  const outputPrefix = (args.outputPrefix as string) || 'devtoolkit-env';
  validateOptionalStrings(args, ['outputDir', 'outputPrefix']);

  const res = await exportEnvironment({ outputDir, outputPrefix });
  return {
    success: true,
    jsonPath: res.jsonPath,
    scriptPath: res.scriptPath,
    summary: res.summary,
  };
}

async function handleDiffEnv(
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshotPath = args.snapshotPath;
  if (typeof snapshotPath !== 'string' || !snapshotPath.trim()) {
    throw new Error('snapshotPath 参数必填');
  }

  const snapshot = loadSnapshot(snapshotPath);
  const diff = await diffEnvironment(snapshot);

  return {
    snapshotPath,
    hasDifferences: diff.hasDifferences,
    summary: diff.summary,
    preview: formatDiffPreview(diff),
    diff,
  };
}

async function handleEvalSkill(
  args: Record<string, unknown>,
  context: McpToolContext,
): Promise<Record<string, unknown>> {
  const skillPath = args.skillPath as string | undefined;
  let skillContent = args.skillContent as string | undefined;
  validateOptionalStrings(args, [
    'skillPath',
    'model',
    'baseUrl',
    'apiKey',
    'localModelName',
  ]);
  if (
    skillContent !== undefined &&
    (typeof skillContent !== 'string' || skillContent.length > 1024 * 1024)
  ) {
    throw new Error('skillContent 参数必须是 1 MiB 以内的字符串');
  }
  if (skillPath && skillContent) {
    throw new Error('skillPath 与 skillContent 只能提供一个');
  }
  if (!skillContent && skillPath) {
    if ((await stat(skillPath)).size > 1024 * 1024) {
      throw new Error('技能文件超过 1 MiB 限制');
    }
    skillContent = await readFile(skillPath, 'utf-8');
  }
  if (!skillContent?.trim()) {
    throw new Error('必须提供非空的 skillContent 或 skillPath');
  }

  const model =
    (args.model as string) || context.defaults.model || 'deepseek-chat';
  const apiKey =
    (args.apiKey as string) ||
    context.defaults.apiKey ||
    process.env.DEEPSEEK_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';
  const baseURL =
    (args.baseUrl as string) || context.defaults.baseURL || undefined;
  const localModelName =
    (args.localModelName as string) || context.defaults.localModelName;

  const timeoutMs = normalizeOptionalInteger(
    args.timeoutMs,
    1_000,
    10 * 60_000,
    'timeoutMs',
  );
  const maxOutputTokens =
    normalizeOptionalInteger(
      args.maxOutputTokens,
      1,
      131_072,
      'maxOutputTokens',
    ) ?? context.maxOutputTokens;
  const concurrency = normalizeOptionalInteger(
    args.concurrency,
    1,
    4,
    'concurrency',
  );
  const maxCases = normalizeOptionalInteger(args.maxCases, 1, 20, 'maxCases');

  if (!isLocalModel(model) && !apiKey) {
    throw new Error(
      '缺少 API Key。请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY 环境变量。',
    );
  }
  validateCustomLocalModel(model, baseURL, localModelName);

  const llm = {
    ...resolveModel(model, {
      apiKey,
      baseUrl: baseURL,
      localModelName,
    }),
    maxOutputTokens,
  };
  const report = await runSkillEval(
    skillContent,
    {
      llm,
      signal: context.signal,
      timeoutMs: timeoutMs ?? context.llmTimeoutMs,
      maxOutputChars: context.maxOutputChars,
      concurrency,
      maxCases,
    },
    skillPath,
  );
  return {
    report,
    markdown: formatEvalReportMarkdown(report),
  };
}

function validateOptionalStrings(
  args: Record<string, unknown>,
  keys: string[],
): void {
  for (const key of keys) {
    const value = args[key];
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > 10_000)
    ) {
      throw new Error(`${key} 参数必须是长度不超过 10000 的字符串`);
    }
  }
}

function validateOptionalBooleans(
  args: Record<string, unknown>,
  keys: string[],
): void {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== 'boolean') {
      throw new Error(`${key} 参数必须是布尔值`);
    }
  }
}

function normalizeOptionalInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`${label} 必须是 ${minimum}-${maximum} 的整数`);
  }
  return value;
}

function validateCustomLocalModel(
  model: string,
  baseURL?: string,
  localModelName?: string,
): void {
  if (model !== 'custom-local') return;
  if (!resolveLocalModelName(model, localModelName)) {
    throw new Error('custom-local 必须提供 localModelName');
  }
  if (!baseURL) {
    throw new Error('custom-local 必须提供 baseUrl');
  }
}
