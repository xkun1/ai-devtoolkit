import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isOpenApiSpec,
  parseOpenApiSpec,
  renderOpenApiToMarkdown,
  loadFromOpenApi,
  extractOpenApiFromBuffer,
} from '../src/loader/openapi.js';
import { loadDocument } from '../src/loader/index.js';

describe('OpenAPI / Swagger 专精加载器', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'devtoolkit-openapi-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const sampleOpenApi3 = {
    openapi: '3.0.3',
    info: {
      title: '电商支付网关 API',
      version: '1.2.0',
      description: '提供订单创建、支付结算与退款管理接口',
    },
    servers: [
      { url: 'https://api.payment.com/v1', description: '生产环境' },
      { url: 'https://sandbox.payment.com/v1', description: '沙箱环境' },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT 授权令牌',
        },
      },
      schemas: {
        User: {
          type: 'object',
          required: ['id', 'username', 'email'],
          properties: {
            id: { type: 'integer', description: '用户 ID' },
            username: { type: 'string', description: '登录用户名' },
            email: { type: 'string', format: 'email', description: '电子邮箱' },
            role: {
              type: 'string',
              enum: ['admin', 'user', 'guest'],
              description: '用户权限',
            },
          },
        },
        CreateOrderRequest: {
          type: 'object',
          required: ['userId', 'amount', 'currency'],
          properties: {
            userId: { type: 'integer', description: '下单用户 ID' },
            amount: { type: 'number', description: '支付金额（分）' },
            currency: {
              type: 'string',
              enum: ['CNY', 'USD'],
              description: '货币类型',
            },
          },
        },
        OrderResponse: {
          type: 'object',
          required: ['orderId', 'status', 'createdAt'],
          properties: {
            orderId: { type: 'string', description: '订单唯一标识' },
            status: { type: 'string', enum: ['pending', 'paid', 'cancelled'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    paths: {
      '/orders': {
        post: {
          tags: ['订单管理'],
          summary: '创建支付订单',
          operationId: 'createOrder',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CreateOrderRequest',
                },
              },
            },
          },
          responses: {
            '201': {
              description: '订单创建成功',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/OrderResponse',
                  },
                },
              },
            },
          },
        },
        get: {
          tags: ['订单管理'],
          summary: '查询订单列表',
          operationId: 'listOrders',
          parameters: [
            {
              name: 'page',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
              description: '页码，默认 1',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer' },
              description: '每页条数',
            },
          ],
          responses: {
            '200': {
              description: '订单列表返回',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      $ref: '#/components/schemas/OrderResponse',
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/orders/{orderId}': {
        get: {
          tags: ['订单管理'],
          summary: '获取单个订单详情',
          parameters: [
            {
              name: 'orderId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: '订单 ID',
            },
          ],
          responses: {
            '200': {
              description: '订单详情',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/OrderResponse',
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  const sampleSwagger2 = {
    swagger: '2.0',
    info: {
      title: '宠物商店 Swagger 2.0 API',
      version: '1.0.0',
      description: '经典 Swagger 2.0 规范测试',
    },
    host: 'petstore.swagger.io',
    basePath: '/v2',
    schemes: ['https', 'http'],
    definitions: {
      Pet: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer', format: 'int64', description: '宠物 ID' },
          name: { type: 'string', description: '宠物名字' },
          status: {
            type: 'string',
            enum: ['available', 'pending', 'sold'],
            description: '售卖状态',
          },
        },
      },
    },
    paths: {
      '/pet': {
        post: {
          tags: ['pet'],
          summary: '添加新宠物',
          operationId: 'addPet',
          parameters: [
            {
              in: 'body',
              name: 'body',
              required: true,
              schema: {
                $ref: '#/definitions/Pet',
              },
            },
          ],
          responses: {
            '200': {
              description: '添加成功',
              schema: {
                $ref: '#/definitions/Pet',
              },
            },
          },
        },
      },
    },
  };

  describe('特征检测 isOpenApiSpec', () => {
    it('应正确识别 OpenAPI 3.0 JSON 字符串与对象', () => {
      expect(isOpenApiSpec(sampleOpenApi3)).toBe(true);
      expect(isOpenApiSpec(JSON.stringify(sampleOpenApi3))).toBe(true);
    });

    it('应正确识别 Swagger 2.0 字符串与对象', () => {
      expect(isOpenApiSpec(sampleSwagger2)).toBe(true);
      expect(isOpenApiSpec(JSON.stringify(sampleSwagger2))).toBe(true);
    });

    it('应根据文件名与 YAML 特征识别', () => {
      expect(isOpenApiSpec('', 'openapi.yaml')).toBe(true);
      expect(isOpenApiSpec('', 'swagger.json')).toBe(true);
      expect(isOpenApiSpec('', 'api-docs.yml')).toBe(true);
      expect(isOpenApiSpec('openapi: 3.0.0\ninfo:\n  title: Test')).toBe(true);
    });

    it('应排除普通 Markdown 与 HTML', () => {
      expect(isOpenApiSpec('# 普通 Markdown 文档')).toBe(false);
      expect(isOpenApiSpec('<html><body><h1>Hello</h1></body></html>')).toBe(
        false,
      );
      expect(isOpenApiSpec('{"name": "my-package", "version": "1.0.0"}')).toBe(
        false,
      );
    });
  });

  describe('规范解析与解引用 parseOpenApiSpec', () => {
    it('应完整解析 OpenAPI 3.0 的标题、Server、Security 与 Endpoints', () => {
      const parsed = parseOpenApiSpec(sampleOpenApi3);
      expect(parsed.specType).toBe('openapi');
      expect(parsed.version).toBe('3.0.3');
      expect(parsed.title).toBe('电商支付网关 API');
      expect(parsed.servers).toEqual([
        'https://api.payment.com/v1 (生产环境)',
        'https://sandbox.payment.com/v1 (沙箱环境)',
      ]);
      expect(parsed.securitySchemes.length).toBe(1);
      expect(parsed.securitySchemes[0].name).toBe('BearerAuth');
      expect(parsed.endpoints.length).toBe(3);
    });

    it('应正确解引用 requestBody 与 response 中的 $ref 模型', () => {
      const parsed = parseOpenApiSpec(sampleOpenApi3);
      const createOrderEp = parsed.endpoints.find(
        (e) => e.path === '/orders' && e.method === 'POST',
      );
      expect(createOrderEp).toBeDefined();
      expect(createOrderEp?.requestBody?.required).toBe(true);

      const reqFields = createOrderEp?.requestBody?.fields || [];
      expect(reqFields.some((f) => f.name === 'userId' && f.required)).toBe(
        true,
      );
      expect(
        reqFields.some((f) => f.name === 'currency' && f.enum?.includes('CNY')),
      ).toBe(true);

      const respFields = createOrderEp?.responses[0].fields || [];
      expect(respFields.some((f) => f.name === 'orderId' && f.required)).toBe(
        true,
      );
    });

    it('应正确解析 Swagger 2.0 规范及 host/basePath', () => {
      const parsed = parseOpenApiSpec(sampleSwagger2);
      expect(parsed.specType).toBe('swagger');
      expect(parsed.servers).toContain('https://petstore.swagger.io/v2');
      expect(parsed.endpoints.length).toBe(1);
      const addPet = parsed.endpoints[0];
      expect(addPet.method).toBe('POST');
      expect(
        addPet.requestBody?.fields.some((f) => f.name === 'name' && f.required),
      ).toBe(true);
    });

    it('应使用标准 YAML 语义解析数组、引号与块文本', () => {
      const parsed = parseOpenApiSpec(`
openapi: 3.0.3
info:
  title: "YAML: 示例 API"
  description: |
    第一行
    第二行
servers:
  - url: https://api.example.com/v1
    description: 生产环境
paths:
  /users:
    get:
      summary: 查询用户
      tags: [用户, 查询]
      responses:
        "200":
          description: 成功
`);
      expect(parsed.title).toBe('YAML: 示例 API');
      expect(parsed.description).toContain('第二行');
      expect(parsed.servers).toEqual(['https://api.example.com/v1 (生产环境)']);
      expect(parsed.endpoints[0].tag).toBe('用户');
    });

    it('拒绝缺少规范版本字段的普通 YAML', () => {
      expect(() =>
        parseOpenApiSpec('info:\n  title: Not OpenAPI\npaths: {}'),
      ).toThrow('缺少版本字段');
    });
  });

  describe('Markdown 渲染与 Token 压缩 renderOpenApiToMarkdown', () => {
    it('渲染输出应包含清晰的 Markdown 路由、入参与结构', () => {
      const parsed = parseOpenApiSpec(sampleOpenApi3);
      const md = renderOpenApiToMarkdown(parsed);

      expect(md).toContain('# 电商支付网关 API');
      expect(md).toContain('## 服务基础地址 (Base URL)');
      expect(md).toContain('https://api.payment.com/v1');
      expect(md).toContain('## 鉴权认证机制 (Authentication)');
      expect(md).toContain('BearerAuth');
      expect(md).toContain('### 📁 模块: 订单管理');
      expect(md).toContain('POST /orders');
      expect(md).toContain('userId');
      expect(md).toContain('orderId');
    });

    it('相比原始冗余 JSON 应具有显著的体积压缩', () => {
      const parsed = parseOpenApiSpec(sampleOpenApi3);
      const md = renderOpenApiToMarkdown(parsed);
      const rawJson = JSON.stringify(sampleOpenApi3, null, 2);

      expect(md.length).toBeLessThan(rawJson.length);
    });
  });

  describe('文件加载与 loadDocument 自动路由', () => {
    it('loadFromOpenApi 应成功读取本地 JSON 规范并返回 LoadedDocument', async () => {
      const filePath = join(tempDir, 'payment-api.json');
      await writeFile(
        filePath,
        JSON.stringify(sampleOpenApi3, null, 2),
        'utf-8',
      );

      const doc = await loadFromOpenApi(filePath);
      expect(doc.source).toBe(filePath);
      expect(doc.title).toBe('电商支付网关 API');
      expect(doc.meta?.format).toBe('openapi');
      expect(doc.meta?.specType).toBe('openapi');
      expect(doc.meta?.endpointsCount).toBe('3');
      expect(doc.content).toContain('POST /orders');
    });

    it('loadDocument 应自动识别 OpenAPI 文件并分发至 OpenAPI 专精加载器', async () => {
      const filePath = join(tempDir, 'swagger.json');
      await writeFile(
        filePath,
        JSON.stringify(sampleSwagger2, null, 2),
        'utf-8',
      );

      const doc = await loadDocument(filePath);
      expect(doc.meta?.format).toBe('openapi');
      expect(doc.title).toBe('宠物商店 Swagger 2.0 API');
      expect(doc.content).toContain('POST /pet');
    });

    it('普通 JSON 配置文件应回退到常规文本读取', async () => {
      const filePath = join(tempDir, 'config.json');
      await writeFile(
        filePath,
        JSON.stringify({ port: 3000, env: 'production' }),
        'utf-8',
      );

      const doc = await loadDocument(filePath);
      expect(doc.meta?.format).toBeUndefined();
      expect(doc.content).toContain('3000');
    });
  });

  describe('Web UI 上传 Buffer 提取 extractOpenApiFromBuffer', () => {
    it('应从 Buffer 提取 OpenAPI 并返回元数据', async () => {
      const buf = Buffer.from(JSON.stringify(sampleOpenApi3), 'utf-8');
      const result = await extractOpenApiFromBuffer(buf, 'payment.json');

      expect(result.title).toBe('电商支付网关 API');
      expect(result.meta.format).toBe('openapi');
      expect(result.meta.endpointsCount).toBe('3');
      expect(result.content).toContain('POST /orders');
    });
  });
});
