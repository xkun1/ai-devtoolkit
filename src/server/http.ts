import type { IncomingMessage, ServerResponse } from 'node:http';
import { WEB_UI_HTML } from './html.js';

export function serveHTML(res: ServerResponse, sessionToken: string): void {
  const safeToken = sessionToken.replace(/[^a-zA-Z0-9_-]/g, '');
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
  });
  res.end(
    WEB_UI_HTML.replace(
      '<head>',
      `<head>\n<meta name="devtoolkit-session" content="${safeToken}">`,
    )
      .replaceAll('__SESSION_TOKEN__', safeToken)
      .replaceAll('__DOC2SKILL_NONCE__', safeToken),
  );
}

export function serveJSON(
  res: ServerResponse,
  status: number,
  data: any,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

export function serveZip(
  res: ServerResponse,
  buffer: Buffer,
  filename: string,
): void {
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '-');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': buffer.length,
    'Content-Disposition': `attachment; filename="${safeFilename}"`,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

/** 读取 JSON 请求体
 *
 * 使用 Buffer 拼接而非 string +=，避免大文档跨 chunk 时的多字节字符截断。
 */
export async function readBody(
  req: IncomingMessage,
  limit: number,
): Promise<any> {
  const buffer = await readRequestBuffer(req, limit);
  const data = buffer.toString('utf-8');
  if (!data) return {};
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, '请求体必须是 JSON 对象');
    }
    return parsed;
  } catch {
    throw new HttpError(400, '请求体必须是合法 JSON 对象');
  }
}

/**
 * 解析 multipart/form-data 请求体（用于文件上传）
 * 零依赖手动解析 boundary 分隔的表单数据
 */
export async function readMultipartBody(
  req: IncomingMessage,
  limit: number,
): Promise<Record<string, string>> {
  const buffer = await readRequestBuffer(req, limit);
  return new Promise((resolve, reject) => {
    try {
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      if (!boundaryMatch) {
        resolve({});
        return;
      }
      const boundary = Buffer.from(`--${boundaryMatch[1].trim()}`);
      const result: Record<string, string> = {};

      // 用 Buffer.indexOf 手动分割（Buffer 没有 split 方法）
      let offset = 0;
      let sepIndex: number;
      const headerSep = Buffer.from('\r\n\r\n');

      while ((sepIndex = buffer.indexOf(boundary, offset)) !== -1) {
        const partStart = sepIndex + boundary.length;
        // 跳过 boundary 后的 \r\n
        const contentStart =
          partStart + 2 <= buffer.length &&
          buffer[partStart] === 0x0d &&
          buffer[partStart + 1] === 0x0a
            ? partStart + 2
            : partStart;

        // 找下一个 boundary
        const nextSep = buffer.indexOf(boundary, contentStart);
        if (nextSep === -1) break;

        // 当前 part 内容（去掉末尾 \r\n）
        let partBuf = buffer.subarray(contentStart, nextSep);
        if (partBuf.length >= 2 && partBuf[partBuf.length - 2] === 0x0d) {
          partBuf = partBuf.subarray(0, partBuf.length - 2);
        }

        // 找 header/content 分隔
        const headerEnd = partBuf.indexOf(headerSep);
        if (headerEnd === -1) {
          offset = nextSep;
          continue;
        }

        const headerStr = partBuf.subarray(0, headerEnd).toString('utf-8');
        const contentBuf = partBuf.subarray(headerEnd + headerSep.length);

        // 提取字段名
        const nameMatch = headerStr.match(/name="([^"]+)"/);
        if (!nameMatch) {
          offset = nextSep;
          continue;
        }
        const fieldName = nameMatch[1];

        // 提取文件名（如果有）
        const filenameMatch = headerStr.match(/filename="([^"]+)"/);
        if (filenameMatch) {
          const fname = filenameMatch[1].toLowerCase();
          const isBinary =
            fname.endsWith('.pdf') ||
            fname.endsWith('.docx') ||
            fname.endsWith('.doc');
          if (isBinary) {
            // 二进制文件用 base64 编码存储，避免 utf-8 转换损坏
            result['binaryContent'] = contentBuf.toString('base64');
            result['mimeType'] = fname.endsWith('.pdf')
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          } else {
            result['fileContent'] = contentBuf.toString('utf-8');
          }
          result['fileName'] = filenameMatch[1];
        } else {
          result[fieldName] = contentBuf.toString('utf-8');
        }

        offset = nextSep;
      }

      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

export function readRequestBuffer(
  req: IncomingMessage,
  limit: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) {
      fail(new HttpError(400, 'Content-Length 无效'));
      return;
    }
    if (declaredLength > limit) {
      fail(new HttpError(413, `请求体超过 ${formatBytes(limit)} 限制`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) {
        fail(new HttpError(413, `请求体超过 ${formatBytes(limit)} 限制`));
        req.destroy();
        return;
      }
      chunks.push(buffer);
    });
    req.on('error', fail);
    req.on('aborted', () => fail(new HttpError(400, '请求被中止')));
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function applySecurityHeaders(
  res: ServerResponse,
  scriptNonce: string,
): void {
  const safeNonce = scriptNonce.replace(/[^a-zA-Z0-9_-]/g, '');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self'; style-src 'unsafe-inline'; script-src 'nonce-${safeNonce}'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
  );
}

export function getAllowedOrigin(
  req: IncomingMessage,
  port: number,
): string | null {
  const hostHeader = req.headers.host;
  if (!hostHeader) return null;
  const parsedHost = parseHostHeader(hostHeader);
  if (!parsedHost) return null;
  const { hostname, port: requestPort } = parsedHost;
  if (!isLoopbackHost(hostname)) return null;
  if (requestPort !== port) return null;
  const expectedOrigin = `http://${hostHeader}`;
  const origin = req.headers.origin;
  if (origin && origin !== expectedOrigin) return null;
  return expectedOrigin;
}

export function parseHostHeader(
  value: string,
): { hostname: string; port: number } | null {
  try {
    const url = new URL(`http://${value}`);
    return {
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port ? Number(url.port) : 80,
    };
  } catch {
    return null;
  }
}

export function hasValidSession(req: IncomingMessage, token: string): boolean {
  return req.headers['x-devtoolkit-token'] === token;
}

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1'
  );
}

export function formatBytes(value: number): string {
  return `${Math.ceil(value / 1024 / 1024)} MiB`;
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
