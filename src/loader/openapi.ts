/**
 * OpenAPI / Swagger 专精加载器
 *
 * 将 OpenAPI 3.0 / 3.1 及 Swagger 2.0 规范（JSON / YAML）智能解析、解引用（$ref 展开）
 * 并提炼为紧凑、高密度的结构化 API 手册 Markdown，减少 80%~90% 的冗余 Token。
 */
import { readFile } from 'node:fs/promises';
import type { LoadedDocument } from '../types/index.js';
import { fetchPublicText, type SafeFetchOptions } from '../utils/safe-fetch.js';
import { parse as parseYaml } from 'yaml';

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie' | 'formData' | 'body' | string;
  required?: boolean;
  type?: string;
  description?: string;
  schema?: any;
}

export interface OpenApiField {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  example?: any;
}

export interface OpenApiEndpoint {
  tag: string;
  path: string;
  method: string;
  summary?: string;
  description?: string;
  operationId?: string;
  deprecated?: boolean;
  parameters: OpenApiParameter[];
  requestBody?: {
    contentType?: string;
    required?: boolean;
    description?: string;
    fields: OpenApiField[];
  };
  responses: Array<{
    status: string;
    description?: string;
    contentType?: string;
    fields: OpenApiField[];
  }>;
}

export interface ParsedOpenApi {
  specType: 'openapi' | 'swagger';
  version: string;
  title: string;
  description?: string;
  servers: string[];
  securitySchemes: Array<{
    name: string;
    type: string;
    in?: string;
    description?: string;
  }>;
  endpoints: OpenApiEndpoint[];
  tags: string[];
  rawLength: number;
}

/** 检测内容或文件名是否符合 OpenAPI / Swagger 特征 */
export function isOpenApiSpec(
  content: string | any,
  filename?: string,
): boolean {
  if (typeof content === 'object' && content !== null) {
    return Boolean(
      content.openapi ||
      content.swagger ||
      (content.paths &&
        (content.info || content.components || content.definitions)),
    );
  }

  if (typeof content === 'string') {
    const trimmed = content.trim();
    if (!trimmed) {
      if (filename) {
        const fn = filename.toLowerCase();
        return Boolean(
          (fn.includes('swagger') ||
            fn.includes('openapi') ||
            fn.includes('api-docs') ||
            fn.includes('api_docs') ||
            fn.includes('apispec')) &&
          (fn.endsWith('.json') || fn.endsWith('.yaml') || fn.endsWith('.yml')),
        );
      }
      return false;
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return Boolean(
            parsed.openapi ||
            parsed.swagger ||
            (parsed.paths &&
              (parsed.info || parsed.components || parsed.definitions)),
          );
        }
      } catch {
        // 不是标准 JSON，继续判断 YAML 特征
      }
    }

    // YAML 特征检测
    if (
      /(?:^|\n)\s*openapi\s*:\s*['"]?3\./m.test(trimmed) ||
      /(?:^|\n)\s*swagger\s*:\s*['"]?2\.0/m.test(trimmed) ||
      (/(?:^|\n)\s*paths\s*:/m.test(trimmed) &&
        /(?:^|\n)\s*info\s*:/m.test(trimmed))
    ) {
      return true;
    }

    if (filename) {
      const fn = filename.toLowerCase();
      if (
        (fn.includes('swagger') ||
          fn.includes('openapi') ||
          fn.includes('api-docs') ||
          fn.includes('api_docs') ||
          fn.includes('apispec')) &&
        (fn.endsWith('.json') || fn.endsWith('.yaml') || fn.endsWith('.yml'))
      ) {
        return true;
      }
    }
  }

  return false;
}

/** 解析 OpenAPI / Swagger 原始文本为结构化规范 */
export function parseOpenApiSpec(raw: string | any): ParsedOpenApi {
  const rawString = typeof raw === 'string' ? raw : JSON.stringify(raw);
  const spec = typeof raw === 'string' ? parseYamlOrJson(raw) : raw;

  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('无效的 OpenAPI / Swagger 数据结构');
  }
  if (typeof spec.openapi !== 'string' && typeof spec.swagger !== 'string') {
    throw new Error('OpenAPI / Swagger 规范缺少版本字段');
  }

  const specType: 'openapi' | 'swagger' = spec.swagger ? 'swagger' : 'openapi';
  const version = String(spec.openapi || spec.swagger || '3.0.0');
  const info = spec.info || {};
  const title = info.title || 'API Specification';
  const description = info.description || '';

  // 提取服务器列表 / BaseURL
  const servers: string[] = [];
  if (spec.servers && Array.isArray(spec.servers)) {
    for (const s of spec.servers) {
      if (s?.url)
        servers.push(s.url + (s.description ? ' (' + s.description + ')' : ''));
    }
  } else if (spec.host) {
    const schemes =
      spec.schemes && spec.schemes.length ? spec.schemes : ['https'];
    const basePath = spec.basePath || '';
    for (const scheme of schemes) {
      servers.push(scheme + '://' + spec.host + basePath);
    }
  } else if (spec.basePath) {
    servers.push(spec.basePath);
  }

  // 提取鉴权机制
  const securitySchemes: Array<{
    name: string;
    type: string;
    in?: string;
    description?: string;
  }> = [];
  const secDefs =
    spec.components?.securitySchemes || spec.securityDefinitions || {};
  for (const [secName, secVal] of Object.entries<any>(secDefs)) {
    if (secVal && typeof secVal === 'object') {
      securitySchemes.push({
        name: secName,
        type: secVal.type || 'apiKey',
        in: secVal.in,
        description: secVal.description,
      });
    }
  }

  // 提取接口列表
  const endpoints: OpenApiEndpoint[] = [];
  const paths = spec.paths || {};
  const tagsSet = new Set<string>();

  const HTTP_METHODS = [
    'get',
    'post',
    'put',
    'delete',
    'patch',
    'options',
    'head',
  ];

  for (const [pathStr, pathItem] of Object.entries<any>(paths)) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    const commonParams: any[] = Array.isArray(pathItem.parameters)
      ? pathItem.parameters
      : [];

    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      const rawTags =
        Array.isArray(operation.tags) && operation.tags.length
          ? operation.tags
          : ['Default'];
      const tag = String(rawTags[0] || 'Default');
      tagsSet.add(tag);

      const allParamsRaw = [
        ...commonParams,
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ];
      const parameters: OpenApiParameter[] = [];

      for (const p of allParamsRaw) {
        const resolved = resolveRef(p, spec);
        if (!resolved || !resolved.name) continue;

        let pType = resolved.type;
        if (!pType && resolved.schema) {
          const s = resolveRef(resolved.schema, spec);
          pType = formatSchemaType(s, spec);
        }

        parameters.push({
          name: resolved.name,
          in: resolved.in || 'query',
          required: resolved.required ?? resolved.in === 'path',
          type: pType || 'string',
          description: resolved.description,
        });
      }

      // 请求体提取
      let requestBody: OpenApiEndpoint['requestBody'] = undefined;

      if (operation.requestBody) {
        const rb = resolveRef(operation.requestBody, spec);
        if (rb && rb.content) {
          const firstContentType =
            Object.keys(rb.content)[0] || 'application/json';
          const contentObj = rb.content[firstContentType];
          const schema = resolveRef(contentObj?.schema, spec);
          const fields = extractFieldsFromSchema(schema, spec);
          requestBody = {
            contentType: firstContentType,
            required: rb.required ?? false,
            description: rb.description,
            fields,
          };
        }
      } else {
        const bodyParam = allParamsRaw.find((p) => {
          const resolved = resolveRef(p, spec);
          return resolved?.in === 'body';
        });
        if (bodyParam) {
          const resolved = resolveRef(bodyParam, spec);
          const schema = resolveRef(resolved.schema, spec);
          const fields = extractFieldsFromSchema(schema, spec);
          requestBody = {
            contentType: 'application/json',
            required: resolved.required ?? false,
            description: resolved.description,
            fields,
          };
        }
      }

      // 响应提取
      const responses: OpenApiEndpoint['responses'] = [];
      const responsesObj = operation.responses || {};

      for (const [status, respRaw] of Object.entries<any>(responsesObj)) {
        const resp = resolveRef(respRaw, spec);
        if (!resp || typeof resp !== 'object') continue;

        let contentType = 'application/json';
        let schema: any = null;

        if (resp.content) {
          contentType = Object.keys(resp.content)[0] || 'application/json';
          schema = resolveRef(resp.content[contentType]?.schema, spec);
        } else if (resp.schema) {
          schema = resolveRef(resp.schema, spec);
        }

        const fields = extractFieldsFromSchema(schema, spec);

        responses.push({
          status,
          description: resp.description || '',
          contentType: schema ? contentType : undefined,
          fields,
        });
      }

      endpoints.push({
        tag,
        path: pathStr,
        method: method.toUpperCase(),
        summary: operation.summary,
        description: operation.description,
        operationId: operation.operationId,
        deprecated: operation.deprecated,
        parameters,
        requestBody,
        responses,
      });
    }
  }

  return {
    specType,
    version,
    title,
    description,
    servers,
    securitySchemes,
    endpoints,
    tags: Array.from(tagsSet),
    rawLength: rawString.length,
  };
}

/** 将解析后的 OpenAPI 规范渲染为高密度 Markdown 手册 */
export function renderOpenApiToMarkdown(parsed: ParsedOpenApi): string {
  const lines: string[] = [];

  // 1. 标题与摘要
  lines.push('# ' + parsed.title);
  if (parsed.version) {
    lines.push(
      '> 规范版本: ' + parsed.specType.toUpperCase() + ' ' + parsed.version,
    );
  }
  if (parsed.description) {
    lines.push('\n' + parsed.description.trim() + '\n');
  }

  // 2. 服务地址
  if (parsed.servers.length > 0) {
    lines.push('## 服务基础地址 (Base URL)');
    for (const server of parsed.servers) {
      lines.push('- `' + server + '`');
    }
    lines.push('');
  }

  // 3. 鉴权认证
  if (parsed.securitySchemes.length > 0) {
    lines.push('## 鉴权认证机制 (Authentication)');
    for (const sec of parsed.securitySchemes) {
      const inInfo = sec.in ? ' (in: ' + sec.in + ')' : '';
      const descInfo = sec.description ? ' - ' + sec.description : '';
      lines.push(
        '- **' + sec.name + '**: `' + sec.type + '`' + inInfo + descInfo,
      );
    }
    lines.push('');
  }

  // 4. 接口按 Tag 分组
  lines.push('## 接口列表 (Endpoints)');

  const endpointsByTag: Record<string, OpenApiEndpoint[]> = {};
  for (const ep of parsed.endpoints) {
    if (!endpointsByTag[ep.tag]) endpointsByTag[ep.tag] = [];
    endpointsByTag[ep.tag].push(ep);
  }

  for (const [tag, eps] of Object.entries(endpointsByTag)) {
    lines.push('\n### 📁 模块: ' + tag + '\n');

    for (const ep of eps) {
      const summaryText = ep.summary ? ' - ' + ep.summary : '';
      const depText = ep.deprecated ? ' [已废弃 / DEPRECATED]' : '';
      lines.push(
        '#### `' + ep.method + ' ' + ep.path + '`' + summaryText + depText,
      );

      if (ep.operationId) {
        lines.push('- **OperationId**: `' + ep.operationId + '`');
      }
      if (ep.description && ep.description !== ep.summary) {
        lines.push('- **说明**: ' + ep.description.trim());
      }

      // 请求参数
      if (ep.parameters.length > 0) {
        lines.push('- **请求参数**:');
        for (const p of ep.parameters) {
          const req = p.required ? '必填' : '可选';
          const desc = p.description ? ' - ' + p.description.trim() : '';
          lines.push(
            '  - `' +
              p.name +
              '` (' +
              p.in +
              ', ' +
              p.type +
              ', ' +
              req +
              ')' +
              desc,
          );
        }
      }

      // 请求体
      if (ep.requestBody && ep.requestBody.fields.length > 0) {
        const ct = ep.requestBody.contentType || 'application/json';
        const req = ep.requestBody.required ? '必填' : '可选';
        lines.push('- **请求体 (`' + ct + '`, ' + req + ')**:');
        for (const f of ep.requestBody.fields) {
          const fReq = f.required ? '必填' : '可选';
          const enumInfo =
            f.enum && f.enum.length ? ' [枚举: ' + f.enum.join(', ') + ']' : '';
          const desc = f.description ? ' - ' + f.description.trim() : '';
          lines.push(
            '  - `' +
              f.name +
              '` (' +
              f.type +
              ', ' +
              fReq +
              ')' +
              enumInfo +
              desc,
          );
        }
      }

      // 响应结构 (优先展示 2xx)
      if (ep.responses.length > 0) {
        const successResp =
          ep.responses.find(
            (r) => r.status.startsWith('2') || r.status === 'default',
          ) || ep.responses[0];
        if (successResp && successResp.fields.length > 0) {
          const desc = successResp.description
            ? ' (' + successResp.description + ')'
            : '';
          lines.push(
            '- **成功响应 (`' + successResp.status + '`)' + desc + '**:',
          );
          for (const f of successResp.fields) {
            const fReq = f.required ? '必填' : '可选';
            const desc = f.description ? ' - ' + f.description.trim() : '';
            lines.push(
              '  - `' + f.name + '` (' + f.type + ', ' + fReq + ')' + desc,
            );
          }
        } else if (successResp) {
          lines.push(
            '- **响应状态**: `' +
              successResp.status +
              '` ' +
              (successResp.description || ''),
          );
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n').trim() + '\n';
}

/** 递归解引用 $ref */
function resolveRef(
  obj: any,
  root: any,
  depth = 0,
  visited = new Set<string>(),
): any {
  if (!obj || typeof obj !== 'object' || depth > 10) return obj;

  if (obj.$ref && typeof obj.$ref === 'string') {
    const refPath = obj.$ref;
    if (visited.has(refPath)) {
      return {
        type: 'object',
        description: '[循环引用 ' + refPath.split('/').pop() + ']',
      };
    }
    visited.add(refPath);

    const parts = refPath.replace(/^#\//, '').split('/');
    let target = root;
    for (const part of parts) {
      if (!target || typeof target !== 'object') break;
      target = target[part];
    }

    if (target) {
      return resolveRef(
        { ...target, ...obj, $ref: undefined },
        root,
        depth + 1,
        new Set(visited),
      );
    }
  }

  return obj;
}

/** 格式化 Schema 类型表示 */
function formatSchemaType(schema: any, root: any): string {
  if (!schema) return 'any';
  const resolved = resolveRef(schema, root);
  if (!resolved) return 'any';

  if (resolved.type === 'array') {
    const items = resolveRef(resolved.items, root);
    const itemType = formatSchemaType(items, root);
    return 'Array<' + itemType + '>';
  }

  if (resolved.type) {
    if (resolved.format) return resolved.type + '(' + resolved.format + ')';
    return resolved.type;
  }

  if (resolved.properties) return 'object';
  if (resolved.enum) return 'enum';
  if (resolved.oneOf) return 'union';
  if (resolved.anyOf) return 'anyOf';

  return 'object';
}

/** 从 Schema 展平提取字段属性 */
function extractFieldsFromSchema(
  schemaRaw: any,
  root: any,
  prefix = '',
  depth = 0,
  visited = new Set<string>(),
): OpenApiField[] {
  if (!schemaRaw || depth > 5) return [];
  const schema = resolveRef(schemaRaw, root, depth, visited);
  if (!schema || typeof schema !== 'object') return [];

  const fields: OpenApiField[] = [];

  if (schema.type === 'array' && schema.items) {
    const itemSchema = resolveRef(schema.items, root, depth + 1, visited);
    return extractFieldsFromSchema(
      itemSchema,
      root,
      prefix ? prefix + '[]' : 'items[]',
      depth + 1,
      visited,
    );
  }

  const properties = schema.properties || {};
  const requiredList: string[] = Array.isArray(schema.required)
    ? schema.required
    : [];

  for (const [propName, propSchemaRaw] of Object.entries<any>(properties)) {
    const propSchema = resolveRef(propSchemaRaw, root, depth + 1, visited);
    const fullName = prefix ? prefix + '.' + propName : propName;
    const isRequired = requiredList.includes(propName);
    const propType = formatSchemaType(propSchema, root);

    fields.push({
      name: fullName,
      type: propType,
      required: isRequired,
      description: propSchema?.description,
      enum: Array.isArray(propSchema?.enum)
        ? propSchema.enum.map(String)
        : undefined,
      example: propSchema?.example,
    });

    if (propSchema?.type === 'object' && propSchema.properties && depth < 3) {
      const nested = extractFieldsFromSchema(
        propSchema,
        root,
        fullName,
        depth + 1,
        visited,
      );
      fields.push(...nested);
    }
  }

  return fields;
}

/** 简易 YAML / JSON 混合解析器 */
function parseYamlOrJson(raw: string): any {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // 尝试回退
    }
  }

  try {
    return parseYaml(raw, {
      maxAliasCount: 100,
      uniqueKeys: true,
    });
  } catch (err: unknown) {
    throw new Error(
      `OpenAPI YAML 解析失败: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

/** 统一的 OpenAPI / Swagger 加载入口（支持 URL 与本地路径） */
export async function loadFromOpenApi(
  source: string,
  content?: string,
  fetchOptions: SafeFetchOptions = {},
): Promise<LoadedDocument> {
  let rawContent = content;

  if (!rawContent) {
    if (/^https?:\/\//i.test(source)) {
      rawContent = (await fetchPublicText(source, fetchOptions)).body;
    } else {
      rawContent = await readFile(source, 'utf-8');
    }
  }

  const parsed = parseOpenApiSpec(rawContent);
  const markdown = renderOpenApiToMarkdown(parsed);

  const compressionRatio =
    parsed.rawLength > 0
      ? Math.max(0, Math.round((1 - markdown.length / parsed.rawLength) * 100))
      : 0;

  return {
    source,
    type: 'text',
    content: markdown,
    title: parsed.title,
    url: /^https?:\/\//i.test(source) ? source : undefined,
    meta: {
      format: 'openapi',
      specType: parsed.specType,
      specVersion: parsed.version,
      endpointsCount: String(parsed.endpoints.length),
      tagsCount: String(parsed.tags.length),
      compressionRatio: compressionRatio + '%',
    },
  };
}

/** 从 Buffer 提取 OpenAPI 文档（Web UI 上传用） */
export async function extractOpenApiFromBuffer(
  buffer: Buffer,
  fileName?: string,
): Promise<{ content: string; title: string; meta: Record<string, string> }> {
  const rawContent = buffer.toString('utf-8');
  const parsed = parseOpenApiSpec(rawContent);
  const markdown = renderOpenApiToMarkdown(parsed);

  const compressionRatio =
    parsed.rawLength > 0
      ? Math.max(0, Math.round((1 - markdown.length / parsed.rawLength) * 100))
      : 0;

  return {
    content: markdown,
    title: parsed.title || (fileName || 'openapi-spec').replace(/\.[^.]+$/, ''),
    meta: {
      format: 'openapi',
      specType: parsed.specType,
      specVersion: parsed.version,
      endpointsCount: String(parsed.endpoints.length),
      tagsCount: String(parsed.tags.length),
      compressionRatio: compressionRatio + '%',
    },
  };
}
