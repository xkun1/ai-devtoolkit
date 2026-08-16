import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  isPostmanCollection,
  parsePostmanCollection,
  renderPostmanToMarkdown,
  loadFromPostman,
  extractPostmanFromBuffer,
} from '../src/loader/postman.js';
import { loadDocument } from '../src/loader/index.js';

describe('Postman Collection (v2 / v2.1) 加载器', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'devtoolkit-postman-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  const samplePostmanV21 = {
    info: {
      _postman_id: '12345678-abcd-ef01-2345-6789abcdef01',
      name: '用户与权限中心 API',
      description: '统一认证与用户权限控制模块接口集合',
      schema:
        'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: [
      {
        name: '认证模块',
        item: [
          {
            name: '用户登录',
            request: {
              method: 'POST',
              header: [
                {
                  key: 'Content-Type',
                  value: 'application/json',
                  description: '请求体格式',
                },
              ],
              body: {
                mode: 'raw',
                raw: '{\n  "username": "admin",\n  "password": "secret"\n}',
              },
              url: {
                raw: 'https://api.auth.example.com/v1/login',
                protocol: 'https',
                host: ['api', 'auth', 'example', 'com'],
                path: ['v1', 'login'],
              },
              description: '使用账号密码换取 JWT Token',
            },
            response: [
              {
                name: '登录成功',
                code: 200,
                status: 'OK',
                body: '{\n  "code": 0,\n  "token": "eyJhbGciOi..."\n}',
              },
            ],
          },
        ],
      },
      {
        name: '用户信息模块',
        item: [
          {
            name: '查询当前用户',
            request: {
              method: 'GET',
              header: [
                {
                  key: 'Authorization',
                  value: 'Bearer {{token}}',
                  description: '访问令牌',
                },
              ],
              url: {
                raw: 'https://api.auth.example.com/v1/user/me?detail=true',
                protocol: 'https',
                host: ['api', 'auth', 'example', 'com'],
                path: ['v1', 'user', 'me'],
                query: [
                  {
                    key: 'detail',
                    value: 'true',
                    description: '是否返回详细信息',
                  },
                ],
              },
              description: '获取当前已登录用户的详细资料',
            },
            response: [],
          },
        ],
      },
    ],
  };

  describe('特征检测 isPostmanCollection', () => {
    it('应正确识别带有 schema 的 Postman v2.1 规范', () => {
      expect(isPostmanCollection(samplePostmanV21)).toBe(true);
    });

    it('应排除普通对象或无 item 数组的对象', () => {
      expect(isPostmanCollection({ hello: 'world' })).toBe(false);
      expect(isPostmanCollection(null)).toBe(false);
      expect(isPostmanCollection('string')).toBe(false);
    });
  });

  describe('解析与转换 parsePostmanCollection', () => {
    it('应解析所有接口及其目录结构与参数', () => {
      const parsed = parsePostmanCollection(samplePostmanV21);
      expect(parsed.name).toBe('用户与权限中心 API');
      expect(parsed.description).toContain('统一认证与用户权限控制');
      expect(parsed.version).toBe('2.1.0');
      expect(parsed.endpoints.length).toBe(2);

      const loginEp = parsed.endpoints.find((e) => e.name === '用户登录');
      expect(loginEp).toBeDefined();
      expect(loginEp?.method).toBe('POST');
      expect(loginEp?.folder).toBe('认证模块');
      expect(loginEp?.bodyRaw).toContain('username');
      expect(loginEp?.exampleResponses.length).toBe(1);
      expect(loginEp?.exampleResponses[0].code).toBe(200);

      const userEp = parsed.endpoints.find((e) => e.name === '查询当前用户');
      expect(userEp).toBeDefined();
      expect(userEp?.method).toBe('GET');
      expect(userEp?.queryParams[0].key).toBe('detail');
    });
  });

  describe('Markdown 渲染 renderPostmanToMarkdown', () => {
    it('应生成结构化易读的 API 手册', () => {
      const parsed = parsePostmanCollection(samplePostmanV21);
      const md = renderPostmanToMarkdown(parsed);

      expect(md).toContain('# 用户与权限中心 API');
      expect(md).toContain('## 📁 认证模块');
      expect(md).toContain('### `POST` 用户登录');
      expect(md).toContain('https://api.auth.example.com/v1/login');
      expect(md).toContain('## 📁 用户信息模块');
      expect(md).toContain('### `GET` 查询当前用户');
    });
  });

  describe('文件加载与 loadDocument 自动集成', () => {
    it('loadFromPostman 能从本地文件载入并产出 LoadedDocument', async () => {
      const filePath = join(tempDir, 'auth-collection.json');
      await writeFile(
        filePath,
        JSON.stringify(samplePostmanV21, null, 2),
        'utf-8',
      );

      const doc = await loadFromPostman(filePath);
      expect(doc.type).toBe('postman');
      expect(doc.title).toBe('用户与权限中心 API');
      expect(doc.meta?.endpointCount).toBe('2');
      expect(doc.content).toContain('用户登录');
    });

    it('loadDocument 遇到 Postman JSON 时应自动识别并解析', async () => {
      const filePath = join(tempDir, 'my_postman_collection.json');
      await writeFile(
        filePath,
        JSON.stringify(samplePostmanV21, null, 2),
        'utf-8',
      );

      const doc = await loadDocument(filePath);
      expect(doc.type).toBe('postman');
      expect(doc.title).toBe('用户与权限中心 API');
    });

    it('extractPostmanFromBuffer 应正确解析前端上传的二进制 Buffer', () => {
      const buf = Buffer.from(JSON.stringify(samplePostmanV21), 'utf-8');
      const doc = extractPostmanFromBuffer(buf, 'uploaded.json');
      expect(doc).not.toBeNull();
      expect(doc?.type).toBe('postman');
      expect(doc?.title).toBe('用户与权限中心 API');
    });
  });
});
