/**
 * Postman Collection (v2 / v2.1) 专精加载器
 *
 * 智能解析 Postman Collection JSON 格式，递归提取文件夹分类、接口请求、
 * Header/Query/Body 参数、Mock 示例及响应码，提炼为高密度结构化 API 技能手册。
 */
import { readFile } from 'node:fs/promises';
import type { LoadedDocument } from '../types/index.js';
import { fetchPublicText, type SafeFetchOptions } from '../utils/safe-fetch.js';

export interface PostmanHeader {
  key: string;
  value: string;
  description?: string;
}

export interface PostmanQueryParam {
  key: string;
  value?: string;
  description?: string;
}

export interface PostmanEndpoint {
  folder: string;
  name: string;
  method: string;
  url: string;
  description?: string;
  headers: PostmanHeader[];
  queryParams: PostmanQueryParam[];
  bodyMode?: string;
  bodyRaw?: string;
  formParams?: Array<{ key: string; value: string; description?: string }>;
  exampleResponses: Array<{
    name: string;
    code: number;
    status: string;
    body?: string;
  }>;
}

export interface ParsedPostmanCollection {
  name: string;
  description?: string;
  version?: string;
  endpoints: PostmanEndpoint[];
}

/** 检查是否为 Postman Collection JSON */
export function isPostmanCollection(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  const info = obj.info as Record<string, unknown> | undefined;

  if (info && typeof info === 'object') {
    if (
      typeof info.schema === 'string' &&
      info.schema.includes('postman.com')
    ) {
      return true;
    }
    if (typeof info._postman_id === 'string' || typeof info.name === 'string') {
      if (Array.isArray(obj.item)) return true;
    }
  }

  return false;
}

/** 解析 Postman Collection */
export function parsePostmanCollection(raw: unknown): ParsedPostmanCollection {
  if (!raw || typeof raw !== 'object') {
    throw new Error('无效的 Postman Collection 数据');
  }

  const obj = raw as Record<string, unknown>;
  const info = asRecord(obj.info) ?? {};
  const collectionName = stringValue(info.name) || 'Postman API Collection';
  const description = stringValue(info.description) || '';
  const schema = stringValue(info.schema) || '';

  const endpoints: PostmanEndpoint[] = [];

  function walkItems(items: unknown[], currentFolder: string) {
    if (!Array.isArray(items)) return;

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;

      const itemRecord = asRecord(item);
      if (!itemRecord) continue;
      if (Array.isArray(itemRecord.item)) {
        const folderName = currentFolder
          ? `${currentFolder} / ${stringValue(itemRecord.name) || 'Folder'}`
          : stringValue(itemRecord.name) || 'General';
        walkItems(itemRecord.item, folderName);
      } else if (itemRecord.request) {
        const reqValue = itemRecord.request;
        const req =
          typeof reqValue === 'string' ? reqValue : (asRecord(reqValue) ?? {});
        const reqRecord = typeof req === 'string' ? undefined : req;
        const method =
          typeof req === 'string'
            ? 'GET'
            : (stringValue(req.method) || 'GET').toUpperCase();

        let urlStr = '';
        const queryParams: PostmanQueryParam[] = [];
        const headers: PostmanHeader[] = [];

        if (typeof req === 'string') {
          urlStr = req;
        } else if (typeof reqRecord?.url === 'string') {
          urlStr = reqRecord.url;
        } else if (reqRecord?.url && typeof reqRecord.url === 'object') {
          const reqUrl = asRecord(reqRecord.url) ?? {};
          urlStr = stringValue(reqUrl.raw) || '';
          if (Array.isArray(reqUrl.query)) {
            for (const q of reqUrl.query) {
              const query = asRecord(q);
              if (query && query.key) {
                queryParams.push({
                  key: String(query.key),
                  value:
                    query.value !== undefined ? String(query.value) : undefined,
                  description: query.description
                    ? String(query.description)
                    : undefined,
                });
              }
            }
          }
        }

        if (reqRecord && Array.isArray(reqRecord.header)) {
          for (const h of reqRecord.header) {
            const header = asRecord(h);
            if (header && header.key) {
              headers.push({
                key: String(header.key),
                value: String(header.value || ''),
                description: header.description
                  ? String(header.description)
                  : undefined,
              });
            }
          }
        }

        let bodyMode: string | undefined;
        let bodyRaw: string | undefined;
        const formParams: Array<{
          key: string;
          value: string;
          description?: string;
        }> = [];

        const reqBody = asRecord(reqRecord?.body);
        if (reqBody) {
          bodyMode = stringValue(reqBody.mode);
          if (reqBody.mode === 'raw' && reqBody.raw) {
            bodyRaw = String(reqBody.raw);
          } else if (
            reqBody.mode === 'urlencoded' &&
            Array.isArray(reqBody.urlencoded)
          ) {
            for (const p of reqBody.urlencoded) {
              const param = asRecord(p);
              if (param && param.key)
                formParams.push({
                  key: String(param.key),
                  value: String(param.value || ''),
                  description: stringValue(param.description),
                });
            }
          } else if (
            reqBody.mode === 'formdata' &&
            Array.isArray(reqBody.formdata)
          ) {
            for (const p of reqBody.formdata) {
              const param = asRecord(p);
              if (param && param.key)
                formParams.push({
                  key: String(param.key),
                  value: String(param.value || ''),
                  description: stringValue(param.description),
                });
            }
          }
        }

        const exampleResponses: PostmanEndpoint['exampleResponses'] = [];
        if (Array.isArray(itemRecord.response)) {
          for (const resp of itemRecord.response) {
            const response = asRecord(resp);
            if (response) {
              exampleResponses.push({
                name: stringValue(response.name) || 'Example Response',
                code: typeof response.code === 'number' ? response.code : 200,
                status: stringValue(response.status) || 'OK',
                body: response.body ? String(response.body) : undefined,
              });
            }
          }
        }

        endpoints.push({
          folder: currentFolder || 'General',
          name: stringValue(itemRecord.name) || urlStr || 'API Request',
          method,
          url: urlStr,
          description:
            stringValue(reqRecord?.description) ||
            stringValue(itemRecord.description) ||
            '',
          headers,
          queryParams,
          bodyMode,
          bodyRaw,
          formParams,
          exampleResponses,
        });
      }
    }
  }

  walkItems(Array.isArray(obj.item) ? obj.item : [], '');

  return {
    name: collectionName,
    description,
    version: schema.includes('v2.1') ? '2.1.0' : '2.0.0',
    endpoints,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 将解析后的 Postman Collection 渲染为高质量 API 手册 Markdown */
export function renderPostmanToMarkdown(
  collection: ParsedPostmanCollection,
): string {
  const lines: string[] = [];

  lines.push('# ' + collection.name);
  lines.push('');
  if (collection.description) {
    lines.push(collection.description.trim());
    lines.push('');
  }
  lines.push(
    '> 来源: Postman Collection (v' +
      (collection.version || '2.0.0') +
      ') | 接口总数: ' +
      collection.endpoints.length +
      ' 个',
  );
  lines.push('');

  const folders: Record<string, PostmanEndpoint[]> = {};
  for (const ep of collection.endpoints) {
    if (!folders[ep.folder]) folders[ep.folder] = [];
    folders[ep.folder].push(ep);
  }

  for (const [folderName, epList] of Object.entries(folders)) {
    lines.push('## 📁 ' + folderName);
    lines.push('');

    for (const ep of epList) {
      lines.push('### `' + ep.method + '` ' + ep.name);
      lines.push('');
      if (ep.description) {
        lines.push(ep.description.trim());
        lines.push('');
      }
      lines.push('- **请求 URL**: `' + (ep.url || '/') + '`');
      lines.push('- **请求方法**: `' + ep.method + '`');

      if (ep.headers.length > 0) {
        lines.push('- **请求头 (Headers)**:');
        for (const h of ep.headers) {
          lines.push(
            '  - `' +
              h.key +
              '`: `' +
              h.value +
              '`' +
              (h.description ? ' (' + h.description + ')' : ''),
          );
        }
      }

      if (ep.queryParams.length > 0) {
        lines.push('- **Query 参数**:');
        for (const q of ep.queryParams) {
          lines.push(
            '  - `' +
              q.key +
              '`' +
              (q.value !== undefined ? ' = `' + q.value + '`' : '') +
              (q.description ? ' (' + q.description + ')' : ''),
          );
        }
      }

      if (ep.formParams && ep.formParams.length > 0) {
        lines.push('- **表单参数 (' + (ep.bodyMode || 'form') + ')**:');
        for (const f of ep.formParams) {
          lines.push(
            '  - `' +
              f.key +
              '`: `' +
              f.value +
              '`' +
              (f.description ? ' (' + f.description + ')' : ''),
          );
        }
      }

      if (ep.bodyRaw) {
        lines.push('- **请求体 (Body)**:');
        lines.push('```json');
        lines.push(ep.bodyRaw.trim().slice(0, 1500));
        lines.push('```');
      }

      if (ep.exampleResponses.length > 0) {
        const firstExample = ep.exampleResponses[0];
        lines.push(
          '- **响应示例 (' +
            firstExample.code +
            ' ' +
            firstExample.status +
            ')**:',
        );
        if (firstExample.body) {
          lines.push('```json');
          lines.push(firstExample.body.trim().slice(0, 1500));
          lines.push('```');
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

/** 从 URL 或本地文件加载 Postman Collection */
export async function loadFromPostman(
  source: string,
  options?: SafeFetchOptions,
): Promise<LoadedDocument> {
  let content: string;
  if (/^https?:\/\//i.test(source)) {
    const res = await fetchPublicText(source, options);
    content = res.body;
  } else {
    content = await readFile(source, 'utf-8');
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error('Postman Collection 文件不是合法的 JSON 格式');
  }

  if (!isPostmanCollection(parsedJson)) {
    throw new Error('该 JSON 文件不符合 Postman Collection 规范结构');
  }

  const collection = parsePostmanCollection(parsedJson);
  const markdown = renderPostmanToMarkdown(collection);

  return {
    source,
    type: 'postman',
    title: collection.name,
    content: markdown,
    meta: {
      postmanVersion: collection.version || '2.0.0',
      endpointCount: String(collection.endpoints.length),
    },
  };
}

/** 从内存 Buffer 识别并解析 Postman Collection（用于 Web UI 拖拽上传） */
export function extractPostmanFromBuffer(
  buffer: Buffer,
  filename = 'collection.json',
): LoadedDocument | null {
  try {
    const text = buffer.toString('utf-8');
    const json = JSON.parse(text);
    if (!isPostmanCollection(json)) return null;

    const collection = parsePostmanCollection(json);
    const markdown = renderPostmanToMarkdown(collection);

    return {
      source: filename,
      type: 'postman',
      title: collection.name || filename,
      content: markdown,
      meta: {
        postmanVersion: collection.version || '2.0.0',
        endpointCount: String(collection.endpoints.length),
      },
    };
  } catch {
    return null;
  }
}
