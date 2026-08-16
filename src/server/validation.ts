import { realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { isLocalModel } from '../models.js';
import { isValidTemplate } from '../templates/index.js';
import { HttpError, isLoopbackHost } from './http.js';

export function validateLocalServiceUrl(value: unknown): string {
  const url = parseUrl(value, '本地模型地址');
  if (url.protocol !== 'http:' || !isLoopbackHost(url.hostname)) {
    throw new HttpError(
      400,
      '本地模型地址仅允许 http://localhost/127.0.0.1/::1',
    );
  }
  if (url.username || url.password) {
    throw new HttpError(400, '本地模型地址不允许包含认证信息');
  }
  return url.href.replace(/\/$/, '');
}

/** 模型探测允许根地址；OpenAI Chat Completions 调用必须以 /v1 为基址。 */
export function toOpenAICompatibleBaseUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || path === '/') url.pathname = '/v1';
  return url.href.replace(/\/$/, '');
}

export function resolveWebModelBaseUrl(
  model: string,
  requestedBaseUrl: string | undefined,
  defaultBaseUrl: string | undefined,
): string | undefined {
  if (isLocalModel(model)) {
    if (requestedBaseUrl) {
      return toOpenAICompatibleBaseUrl(
        validateLocalServiceUrl(requestedBaseUrl),
      );
    }
    if (defaultBaseUrl) {
      try {
        return toOpenAICompatibleBaseUrl(
          validateLocalServiceUrl(defaultBaseUrl),
        );
      } catch {
        // 默认配置可能属于云端模型；此时回退到本地模型自身预设。
      }
    }
    return undefined;
  }

  if (requestedBaseUrl && requestedBaseUrl !== defaultBaseUrl) {
    throw new HttpError(400, 'Web UI 不允许覆盖云端模型服务地址');
  }
  return defaultBaseUrl;
}

export async function resolveProjectPath(
  projectRoot: string,
  requestedPath?: unknown,
): Promise<string> {
  if (requestedPath !== undefined && typeof requestedPath !== 'string') {
    throw new HttpError(400, '项目路径必须是字符串');
  }
  const requested = requestedPath?.trim() || '.';
  if (requested.length > 10_000 || requested.includes('\0')) {
    throw new HttpError(400, '项目路径无效');
  }
  const candidate = resolve(projectRoot, requested);
  let canonicalPath: string;
  try {
    canonicalPath = await realpath(candidate);
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      throw new HttpError(404, `路径不存在: ${requested}`);
    }
    throw err;
  }

  const rel = relative(projectRoot, canonicalPath);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HttpError(403, '禁止访问项目根目录之外的路径');
  }
  return canonicalPath;
}

export function parseUrl(value: unknown, label: string): URL {
  try {
    return new URL(String(value));
  } catch {
    throw new HttpError(400, `${label} 格式无效`);
  }
}

export function validateGenerateInput(input: {
  agentType?: unknown;
  template?: unknown;
  modelName?: unknown;
  localModelName?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
}): void {
  if (
    input.agentType !== undefined &&
    !['codex', 'cursor', 'claude'].includes(String(input.agentType))
  ) {
    throw new HttpError(400, '无效的 Agent 类型');
  }
  if (
    input.template !== undefined &&
    input.template !== '' &&
    !isValidTemplate(String(input.template))
  ) {
    throw new HttpError(400, '未知模板');
  }
  for (const [label, value] of [
    ['模型名', input.modelName],
    ['本地模型名', input.localModelName],
  ] as const) {
    if (value !== undefined && String(value).length > 200) {
      throw new HttpError(400, `${label}过长`);
    }
  }
  if (input.fileName !== undefined) {
    const name = String(input.fileName);
    if (name.length > 255 || /[\\/\0]/.test(name)) {
      throw new HttpError(400, '上传文件名无效');
    }
    if (
      !/\.(md|markdown|txt|text|html?|pdf|docx|json|ya?ml|xml|csv)$/i.test(name)
    ) {
      throw new HttpError(400, '不支持的上传文件类型');
    }
  }
  if (input.mimeType !== undefined && String(input.mimeType).length > 200) {
    throw new HttpError(400, 'MIME 类型无效');
  }
}
