import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AgentType } from '../../types/index.js';
import { isValidAgentType } from '../../format/index.js';
import { resolveModel } from '../../models.js';
import {
  detectEnvironment,
  diffEnvironment,
  formatDiffPreview,
} from '../../env/index.js';
import {
  convertRule,
  parseRule,
  discoverProjectRules,
  syncProjectRules,
} from '../../convert/index.js';
import { runSkillEval, formatEvalReportMarkdown } from '../../eval/index.js';
import { HttpError, getErrorMessage, readBody, serveJSON } from '../http.js';
import { resolveProjectPath, resolveWebModelBaseUrl } from '../validation.js';
import type { ServerTaskLimits } from '../types.js';

export async function handleEnvDetect(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const snapshot = await detectEnvironment();
  serveJSON(res, 200, { snapshot });
}

export async function handleEnvDiff(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    snapshot?: any;
  };
  if (!body.snapshot || typeof body.snapshot !== 'object') {
    throw new HttpError(400, '缺少快照数据');
  }
  let diff: Awaited<ReturnType<typeof diffEnvironment>>;
  try {
    diff = await diffEnvironment(body.snapshot);
  } catch (err) {
    throw new HttpError(400, `环境快照无效: ${getErrorMessage(err)}`);
  }
  serveJSON(res, 200, {
    diff,
    preview: formatDiffPreview(diff),
  });
}

// ─── 规则互转、技能评测、依赖图谱 API 处理函数 ───

export async function handleConvert(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    content?: string;
    to?: AgentType;
    name?: string;
  };
  if (
    typeof body.content !== 'string' ||
    !body.content.trim() ||
    typeof body.to !== 'string'
  ) {
    throw new HttpError(400, '缺少 content 或 to 参数');
  }
  if (body.content.length > 1024 * 1024) {
    throw new HttpError(413, '规则内容超过 1 MiB 限制');
  }
  if (!isValidAgentType(String(body.to))) {
    throw new HttpError(400, '无效的目标 Agent 类型');
  }
  if (
    body.name !== undefined &&
    (typeof body.name !== 'string' || body.name.length > 200)
  ) {
    throw new HttpError(400, '规则名称无效或过长');
  }
  const parsed = parseRule(body.content);
  const result = convertRule(parsed, { to: body.to, name: body.name });
  serveJSON(res, 200, {
    success: true,
    from: result.from,
    to: result.to,
    artifacts: result.artifacts,
    preview: result.artifacts[0]?.content || '',
  });
}

export async function handleSyncDiscover(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body =
    req.method === 'POST'
      ? ((await readBody(req, maxBodyBytes)) as { projectRoot?: string })
      : {};
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const discovered = await discoverProjectRules(root);
  serveJSON(res, 200, {
    projectRoot: root,
    discovered,
    totalFiles: discovered.reduce((acc, d) => acc + d.files.length, 0),
  });
}

export async function handleSync(
  req: IncomingMessage,
  res: ServerResponse,
  maxBodyBytes: number,
  projectRoot: string,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    projectRoot?: string;
    from?: AgentType | 'auto';
    to?: AgentType[];
    dryRun?: boolean;
  };
  if (
    body.from !== undefined &&
    !['auto', 'codex', 'cursor', 'claude'].includes(String(body.from))
  ) {
    throw new HttpError(400, '无效的同步源 Agent 类型');
  }
  if (
    body.to !== undefined &&
    (!Array.isArray(body.to) ||
      body.to.length > 3 ||
      body.to.some((agent) => !isValidAgentType(String(agent))))
  ) {
    throw new HttpError(400, '无效的同步目标 Agent 列表');
  }
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') {
    throw new HttpError(400, 'dryRun 必须是布尔值');
  }
  const root = await resolveProjectPath(projectRoot, body.projectRoot);
  const result = await syncProjectRules({
    projectRoot: root,
    from: body.from,
    to: body.to,
    dryRun: body.dryRun ?? true,
  });
  serveJSON(res, 200, result);
}

export async function handleEval(
  req: IncomingMessage,
  res: ServerResponse,
  defaultLLM: { apiKey: string; baseURL?: string; model: string },
  maxBodyBytes: number,
  limits: ServerTaskLimits,
): Promise<void> {
  const body = (await readBody(req, maxBodyBytes)) as {
    skillContent?: string;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    localModelName?: string;
  };
  if (typeof body.skillContent !== 'string' || !body.skillContent.trim()) {
    throw new HttpError(400, '缺少 skillContent 参数');
  }
  if (body.skillContent.length > 1024 * 1024) {
    throw new HttpError(413, '技能内容超过 1 MiB 限制');
  }
  for (const [label, value] of [
    ['model', body.model],
    ['apiKey', body.apiKey],
    ['baseURL', body.baseURL],
    ['localModelName', body.localModelName],
  ] as const) {
    if (
      value !== undefined &&
      (typeof value !== 'string' || value.length > 10_000)
    ) {
      throw new HttpError(400, `${label} 参数无效`);
    }
  }

  const model = String(body.model || defaultLLM.model);
  const apiKey = body.apiKey || defaultLLM.apiKey;
  const localModelName = body.localModelName;
  const safeBaseUrl = resolveWebModelBaseUrl(
    model,
    body.baseURL,
    defaultLLM.baseURL,
  );

  let llmConfig: ReturnType<typeof resolveModel> & {
    maxOutputTokens?: number;
  };
  try {
    llmConfig = {
      ...resolveModel(model, {
        apiKey,
        baseUrl: safeBaseUrl,
        localModelName,
      }),
      maxOutputTokens: limits.maxOutputTokens,
    };
  } catch (err) {
    throw new HttpError(400, getErrorMessage(err));
  }

  const report = await runSkillEval(body.skillContent, {
    llm: llmConfig,
    signal: limits.signal,
    timeoutMs: limits.llmTimeoutMs,
    maxOutputChars: limits.maxOutputChars,
  });
  serveJSON(res, 200, {
    report,
    markdown: formatEvalReportMarkdown(report),
  });
}
