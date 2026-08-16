import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { throwIfAborted, toAbortError } from './abort.js';

export interface SafeFetchResult {
  body: string;
  contentType: string;
  finalUrl: string;
}

export interface SafeFetchOptions {
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  signal?: AbortSignal;
}

export class SafeFetchError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * 只抓取公网 HTTP(S) 文本，并在 DNS 解析、重定向和响应体大小处重复校验。
 * 自定义 lookup 会把实际连接固定到已校验的公网 IP，避免 DNS rebinding。
 */
export async function fetchPublicText(
  input: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  throwIfAborted(options.signal, '远程文档抓取');
  return fetchStep(
    input,
    options.maxBytes ?? 5 * 1024 * 1024,
    options.timeoutMs ?? 30_000,
    options.maxRedirects ?? 5,
    options.signal,
  );
}

async function fetchStep(
  input: string,
  maxBytes: number,
  timeoutMs: number,
  redirectsLeft: number,
  signal?: AbortSignal,
): Promise<SafeFetchResult> {
  throwIfAborted(signal, '远程文档抓取');
  const url = validatePublicHttpUrl(input);
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup: createPublicLookup(),
        headers: {
          'User-Agent': 'devtoolkit/secure-fetch',
          Accept:
            'text/html,application/xhtml+xml,text/plain,text/markdown,application/json,application/yaml,application/x-yaml,text/yaml;q=0.8',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new SafeFetchError(400, '文档 URL 重定向次数过多'));
            return;
          }
          fetchStep(
            new URL(location, url).href,
            maxBytes,
            timeoutMs,
            redirectsLeft - 1,
            signal,
          ).then(resolve, reject);
          return;
        }

        if (status < 200 || status >= 300) {
          res.resume();
          reject(new SafeFetchError(502, `文档服务器返回 HTTP ${status}`));
          return;
        }

        const declaredLength = Number(res.headers['content-length'] || 0);
        if (declaredLength > maxBytes) {
          res.destroy();
          reject(
            new SafeFetchError(
              413,
              `远程文档超过 ${formatBytes(maxBytes)} 限制`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.from(chunk);
          size += buffer.length;
          if (size > maxBytes) {
            res.destroy(
              new SafeFetchError(
                413,
                `远程文档超过 ${formatBytes(maxBytes)} 限制`,
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        res.on('error', reject);
        res.on('end', () => {
          resolve({
            body: Buffer.concat(chunks).toString('utf-8'),
            contentType: String(res.headers['content-type'] || ''),
            finalUrl: url.href,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new SafeFetchError(504, '抓取文档超时'));
    });
    const onAbort = () => {
      req.destroy(toAbortError(signal?.reason, '远程文档抓取已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.once('close', () => signal?.removeEventListener('abort', onAbort));
    req.on('error', reject);
    req.end();
  });
}

export function validatePublicHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError(400, '文档 URL 格式无效');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new SafeFetchError(400, '文档来源仅支持 HTTP(S) URL');
  }
  if (url.username || url.password) {
    throw new SafeFetchError(400, '文档 URL 不允许包含认证信息');
  }
  const hostname = normalizeHost(url.hostname);
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    (isIP(hostname) > 0 && !isPublicIp(hostname))
  ) {
    throw new SafeFetchError(400, '文档 URL 不允许访问本机或私有网络');
  }
  return url;
}

function createPublicLookup(): LookupFunction {
  return ((
    hostname: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | Array<{ address: string; family: number }>,
      family?: number,
    ) => void,
  ) => {
    dnsLookup(hostname, { all: true, verbatim: true })
      .then((addresses) => {
        const publicAddresses = addresses.filter((item) =>
          isPublicIp(item.address),
        );
        const proxyMappedAddresses = addresses.filter((item) =>
          isProxyMappedBenchmarkIp(item.address),
        );
        const allowedAddresses = publicAddresses.length
          ? publicAddresses
          : allowProxyMappedBenchmarkIp()
            ? proxyMappedAddresses
            : [];
        if (!allowedAddresses.length) {
          callback(
            Object.assign(new Error('目标域名解析到本机、私有或保留地址'), {
              code: 'EACCES',
            }),
            [],
          );
          return;
        }
        const first = allowedAddresses[0];
        if (options.all) {
          callback(null, [first]);
        } else {
          callback(null, first.address, first.family);
        }
      })
      .catch((err: NodeJS.ErrnoException) => callback(err, []));
  }) as LookupFunction;
}

export function isPublicIp(address: string): boolean {
  const host = normalizeHost(address);
  const family = isIP(host);
  if (family === 4) {
    const [a, b, c] = host.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = host.toLowerCase();
    if (lower.startsWith('::ffff:')) {
      return isPublicIp(lower.slice('::ffff:'.length));
    }
    return !(
      lower === '::' ||
      lower === '::1' ||
      lower.startsWith('::') ||
      lower.startsWith('64:ff9b:') ||
      lower.startsWith('100::') ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe8') ||
      lower.startsWith('fe9') ||
      lower.startsWith('fea') ||
      lower.startsWith('feb') ||
      lower.startsWith('fec') ||
      lower.startsWith('fed') ||
      lower.startsWith('fee') ||
      lower.startsWith('fef') ||
      lower.startsWith('ff') ||
      lower.startsWith('2001::') ||
      lower.startsWith('2001:2:') ||
      lower.startsWith('2001:10:') ||
      lower.startsWith('2001:20:') ||
      lower.startsWith('2001:db8:') ||
      lower.startsWith('2002:')
    );
  }
  return false;
}

/**
 * 某些受管环境会把公网 DNS 映射到 RFC 2544 的 198.18.0.0/15，
 * 仅在显式开启 DEVTOOLKIT_ALLOW_PROXY_MAPPED_IP=1 且配置代理时允许该映射；
 * 默认始终拒绝此保留网段，避免仅设置 HTTP_PROXY 就削弱 SSRF 边界。
 */
function isProxyMappedBenchmarkIp(address: string): boolean {
  const host = normalizeHost(address);
  if (isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 198 && (b === 18 || b === 19);
}

function allowProxyMappedBenchmarkIp(): boolean {
  return (
    process.env.DEVTOOLKIT_ALLOW_PROXY_MAPPED_IP === '1' &&
    Boolean(
      process.env.HTTPS_PROXY ||
      process.env.HTTP_PROXY ||
      process.env.https_proxy ||
      process.env.http_proxy,
    )
  );
}

function normalizeHost(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, '');
}

function formatBytes(value: number): string {
  return `${Math.ceil(value / 1024 / 1024)} MiB`;
}
