import { stringify as stringifyYaml } from 'yaml';
import {
  parseOpenApiSpec,
  renderOpenApiToMarkdown,
} from '../src/loader/openapi.js';

interface BenchmarkSample {
  name: string;
  format: 'OpenAPI 3.0' | 'Swagger 2.0';
  raw: string;
}

interface BenchmarkResult {
  name: string;
  format: BenchmarkSample['format'];
  rawChars: number;
  outputChars: number;
  rawTokens: number;
  outputTokens: number;
  savedPercent: number;
  endpoints: number;
}

const REPEATABLE_DETAIL =
  '该字段用于记录业务对象的显示名称，客户端可以在列表和详情页面中展示。';

/**
 * 生成一组固定的、带有真实文档常见元数据的 OpenAPI 样本。
 * x-* 扩展、示例和校验约束属于解析器刻意丢弃的冗余信息，
 * 用于衡量结构化提炼路径在实际文档中的压缩效果。
 */
function buildOpenApiSample(resourceCount: number, noiseSize: number) {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (let index = 1; index <= resourceCount; index += 1) {
    const resource = `resource${index}`;
    const plural = `${resource}s`;
    const title = `资源 ${index}`;
    const schemaName = `${resource[0].toUpperCase()}${resource.slice(1)}`;
    const commonProperties = {
      id: {
        type: 'string',
        format: 'uuid',
        description: `${title}的唯一标识。${REPEATABLE_DETAIL}`,
        example: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
        minLength: 36,
        maxLength: 36,
      },
      name: {
        type: 'string',
        description: `${title}名称。${REPEATABLE_DETAIL}`,
        example: `${title}示例`,
        minLength: 1,
        maxLength: 128,
        pattern: '^[\\u4e00-\\u9fa5A-Za-z0-9_-]+$',
      },
      status: {
        type: 'string',
        description: `${title}当前状态。`,
        enum: ['active', 'archived', 'pending'],
        default: 'active',
      },
      createdAt: {
        type: 'string',
        format: 'date-time',
        description: '创建时间，使用 ISO 8601 格式。',
        example: '2026-01-01T00:00:00Z',
      },
      ownerId: {
        type: 'string',
        description: '所属用户 ID。',
        example: 'owner-0001',
      },
    };

    schemas[schemaName] = {
      type: 'object',
      description: `${title}完整对象。该对象包含服务端生成的审计字段和状态字段。`,
      required: ['id', 'name', 'status', 'createdAt'],
      properties: commonProperties,
      additionalProperties: false,
      example: {
        id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}`,
        name: `${title}示例`,
        status: 'active',
        createdAt: '2026-01-01T00:00:00Z',
        ownerId: 'owner-0001',
      },
      'x-display': {
        icon: 'database',
        color: '#2563EB',
        tableColumns: ['id', 'name', 'status', 'createdAt'],
      },
    };

    schemas[`${schemaName}Create`] = {
      type: 'object',
      required: ['name'],
      properties: {
        name: commonProperties.name,
        ownerId: commonProperties.ownerId,
      },
      'x-form': {
        layout: 'vertical',
        helpText: '创建时只需提供名称，可选提供所属用户。',
      },
    };

    const noisyExtension = {
      purpose:
        '此扩展用于生成 SDK、交互式文档和测试夹具，结构化 API 手册不需要重复携带这些内容。',
      curl: `curl -X GET https://api.example.com/v1/${plural} -H 'Authorization: Bearer <token>'`,
      // 模拟常见的多语言代码示例；解析器只保留路由和字段，不复制这些示例。
      ignoredDocumentation: REPEATABLE_DETAIL.repeat(100),
      responseExample: {
        data: Array.from({ length: noiseSize }, (_, item) => ({
          id: `${resource}-${item + 1}`,
          name: `${title}-${item + 1}`,
          status: 'active',
        })),
        page: 1,
        pageSize: 20,
      },
    };

    paths[`/${plural}`] = {
      get: {
        tags: [title],
        summary: `查询${title}列表`,
        operationId: `list${schemaName}`,
        description: `分页查询${title}。支持按状态筛选，并返回稳定的分页结果。`,
        parameters: [
          {
            name: 'page',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, default: 1 },
            description: '页码，从 1 开始。',
          },
          {
            name: 'pageSize',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            description: '每页条数，最大 100。',
          },
          {
            name: 'status',
            in: 'query',
            required: false,
            schema: { type: 'string', enum: ['active', 'archived', 'pending'] },
            description: '按资源状态筛选。',
          },
        ],
        responses: {
          '200': {
            description: '列表查询成功。',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: `#/components/schemas/${schemaName}` },
                },
              },
            },
          },
          '401': { description: '未授权。' },
        },
        'x-codeSamples': [noisyExtension],
      },
      post: {
        tags: [title],
        summary: `创建${title}`,
        operationId: `create${schemaName}`,
        description: `创建一条新的${title}并返回服务端生成的完整对象。`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: `#/components/schemas/${schemaName}Create` },
            },
          },
        },
        responses: {
          '201': {
            description: '创建成功。',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${schemaName}` },
              },
            },
          },
          '422': { description: '请求参数校验失败。' },
        },
        'x-codeSamples': [noisyExtension],
      },
    };

    paths[`/${plural}/{id}`] = {
      get: {
        tags: [title],
        summary: `获取${title}详情`,
        operationId: `get${schemaName}`,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: `${title}唯一标识。`,
          },
        ],
        responses: {
          '200': {
            description: '查询成功。',
            content: {
              'application/json': {
                schema: { $ref: `#/components/schemas/${schemaName}` },
              },
            },
          },
          '404': { description: '资源不存在。' },
        },
        'x-codeSamples': [noisyExtension],
      },
      delete: {
        tags: [title],
        summary: `归档${title}`,
        operationId: `archive${schemaName}`,
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            description: `${title}唯一标识。`,
          },
        ],
        responses: { '204': { description: '归档成功。' } },
        'x-codeSamples': [noisyExtension],
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: '企业资源管理 API',
      version: '2026.01',
      description:
        '用于管理企业资源的 HTTP API。本文档同时服务于 SDK 生成、交互式文档和人工阅读。',
      contact: { name: 'API Platform Team', email: 'api@example.com' },
      license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
      'x-generated-at': '2026-01-01T00:00:00Z',
    },
    servers: [
      { url: 'https://api.example.com/v1', description: '生产环境' },
      { url: 'https://sandbox.example.com/v1', description: '沙箱环境' },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: '使用短期 JWT 访问令牌。',
        },
      },
      schemas,
    },
    paths,
  };
}

function buildSwaggerSample(resourceCount: number, noiseSize: number) {
  const definitions: Record<string, unknown> = {};
  const paths: Record<string, unknown> = {};

  for (let index = 1; index <= resourceCount; index += 1) {
    const resource = `legacy${index}`;
    const title = `旧版资源 ${index}`;
    const schemaName = `Legacy${index}`;
    definitions[schemaName] = {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: { type: 'integer', format: 'int64', description: `${title} ID。`, example: index },
        name: {
          type: 'string',
          description: `${title}名称。${REPEATABLE_DETAIL}`,
          example: `${title}示例`,
          minLength: 1,
          maxLength: 128,
        },
        status: {
          type: 'string',
          enum: ['active', 'disabled'],
          description: '状态。',
          default: 'active',
        },
      },
      example: { id: index, name: `${title}示例`, status: 'active' },
      'x-fixture': Array.from({ length: noiseSize }, (_, item) => ({
        id: item + 1,
        name: `${title}-${item + 1}`,
      })),
    };

    const extension = {
      description: 'Swagger 2.0 兼容层中的代码示例和测试数据。',
      sdk: { javascript: `client.${resource}.list({ page: 1, limit: 20 })` },
      ignoredDocumentation: REPEATABLE_DETAIL.repeat(100),
      examples: Array.from({ length: noiseSize }, (_, item) => ({ id: item + 1 })),
    };

    paths[`/${resource}s`] = {
      get: {
        tags: [title],
        summary: `查询${title}列表`,
        operationId: `list${schemaName}`,
        produces: ['application/json'],
        parameters: [
          { name: 'page', in: 'query', type: 'integer', required: false, description: '页码。' },
          { name: 'limit', in: 'query', type: 'integer', required: false, description: '每页条数。' },
        ],
        responses: {
          '200': {
            description: '查询成功。',
            schema: { type: 'array', items: { $ref: `#/definitions/${schemaName}` } },
          },
        },
        'x-codeSamples': [extension],
      },
      post: {
        tags: [title],
        summary: `创建${title}`,
        operationId: `create${schemaName}`,
        consumes: ['application/json'],
        parameters: [
          {
            in: 'body',
            name: 'body',
            required: true,
            schema: { $ref: `#/definitions/${schemaName}` },
            description: '要创建的资源。',
          },
        ],
        responses: {
          '201': { description: '创建成功。', schema: { $ref: `#/definitions/${schemaName}` } },
        },
        'x-codeSamples': [extension],
      },
    };
  }

  return {
    swagger: '2.0',
    info: {
      title: 'Legacy Resource API',
      version: '1.8.0',
      description: '兼容旧客户端的 Swagger 2.0 资源 API。',
    },
    host: 'legacy.example.com',
    basePath: '/v2',
    schemes: ['https'],
    consumes: ['application/json'],
    produces: ['application/json'],
    securityDefinitions: {
      apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'API Key。' },
    },
    definitions,
    paths,
  };
}

const samples: BenchmarkSample[] = [
  {
    name: 'OpenAPI 3 基础（2 资源 / 8 接口）',
    format: 'OpenAPI 3.0',
    raw: stringifyYaml(buildOpenApiSample(2, 20), { lineWidth: 0 }),
  },
  {
    name: 'OpenAPI 3 中型（5 资源 / 20 接口）',
    format: 'OpenAPI 3.0',
    raw: stringifyYaml(buildOpenApiSample(5, 24), { lineWidth: 0 }),
  },
  {
    name: 'Swagger 2.0 兼容（6 资源 / 12 接口）',
    format: 'Swagger 2.0',
    raw: stringifyYaml(buildSwaggerSample(6, 28), { lineWidth: 0 }),
  },
];

function benchmark(sample: BenchmarkSample): BenchmarkResult {
  const parsed = parseOpenApiSpec(sample.raw);
  const output = renderOpenApiToMarkdown(parsed);
  const rawTokens = Math.ceil(sample.raw.length / 4);
  const outputTokens = Math.ceil(output.length / 4);

  return {
    name: sample.name,
    format: sample.format,
    rawChars: sample.raw.length,
    outputChars: output.length,
    rawTokens,
    outputTokens,
    savedPercent: Math.round((1 - output.length / sample.raw.length) * 1000) / 10,
    endpoints: parsed.endpoints.length,
  };
}

function printResults(results: BenchmarkResult[]) {
  console.log('devtoolkit OpenAPI 结构化提炼 Benchmark');
  console.log('估算口径：token ≈ 字符数 / 4；仅测确定性解析与 Markdown 渲染，不调用 LLM。\n');
  console.table(
    results.map((result) => ({
      样本: result.name,
      规范: result.format,
      接口数: result.endpoints,
      原始字符: result.rawChars,
      产物字符: result.outputChars,
      原始Token: result.rawTokens,
      产物Token: result.outputTokens,
      节省: `${result.savedPercent.toFixed(1)}%`,
    })),
  );
}

printResults(samples.map(benchmark));
