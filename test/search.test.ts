import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import {
  detectLanguage,
  isCodeFile,
  extractSymbols,
} from '../src/search/scanner.js';
import {
  buildIndex,
  updateIndex,
  saveIndex,
  loadIndex,
  hasIndex,
  INDEX_VERSION,
} from '../src/search/indexer.js';
import { searchCode, CodeSearcher } from '../src/search/searcher.js';
import { formatResultsPlain } from '../src/search/explainer.js';
import type { SearchIndex } from '../src/search/types.js';

// ── 测试用临时项目 ──
let tmpProject: string;

beforeEach(() => {
  tmpProject = mkdtempSync(join(tmpdir(), 'd2s-test-'));
  // 创建一个模拟项目结构
  mkdirSync(join(tmpProject, 'src'), { recursive: true });
  mkdirSync(join(tmpProject, 'src', 'controllers'), { recursive: true });
  mkdirSync(join(tmpProject, 'src', 'models'), { recursive: true });

  writeFileSync(
    join(tmpProject, 'src', 'controllers', 'UserController.ts'),
    `export class UserController {
  async login(req: Request, res: Response) {
    const { username, password } = req.body;
    const user = await this.userService.authenticate(username, password);
    if (!user) {
      return res.status(401).json({ error: '认证失败' });
    }
    const token = generateToken(user);
    return res.json({ token, user });
  }

  async register(req: Request, res: Response) {
    const { username, email, password } = req.body;
    const newUser = await this.userService.createUser({ username, email, password });
    return res.status(201).json(newUser);
  }
}
`,
  );

  writeFileSync(
    join(tmpProject, 'src', 'models', 'User.ts'),
    `export interface User {
  id: number;
  username: string;
  email: string;
  createdAt: Date;
}

export enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

export type UserPreview = Pick<User, 'id' | 'username'>;
`,
  );

  writeFileSync(
    join(tmpProject, 'src', 'utils.ts'),
    `export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export const MAX_RETRY = 3;
export const DEFAULT_TIMEOUT = 5000;
`,
  );

  writeFileSync(
    join(tmpProject, 'src', 'pagination.ts'),
    `export interface PaginationResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function paginate<T>(items: T[], page: number, pageSize: number): PaginationResult<T> {
  const start = (page - 1) * pageSize;
  const data = items.slice(start, start + pageSize);
  return { data, total: items.length, page, pageSize };
}
`,
  );

  // Java 文件
  mkdirSync(join(tmpProject, 'java-src'), { recursive: true });
  writeFileSync(
    join(tmpProject, 'java-src', 'OrderService.java'),
    `public class OrderService {
  public Order createOrder(String userId, List<Item> items) {
    Order order = new Order();
    order.setUserId(userId);
    order.setItems(items);
    return orderRepository.save(order);
  }
}
`,
  );

  // Python 文件
  writeFileSync(
    join(tmpProject, 'data_processor.py'),
    `class DataProcessor:
    def process_data(self, raw_data):
        cleaned = self.clean(raw_data)
        return self.transform(cleaned)

    def clean(self, data):
        return [d for d in data if d is not None]
`,
  );

  // 应被忽略的目录
  mkdirSync(join(tmpProject, 'node_modules'), { recursive: true });
  writeFileSync(
    join(tmpProject, 'node_modules', 'should-not-scan.js'),
    'console.log("should not appear")',
  );
});

afterEach(() => {
  rmSync(tmpProject, { recursive: true, force: true });
});

// ── scanner 测试 ──
describe('scanner', () => {
  it('detectLanguage 正确识别语言', () => {
    expect(detectLanguage('foo.ts')).toBe('typescript');
    expect(detectLanguage('foo.tsx')).toBe('typescript');
    expect(detectLanguage('foo.js')).toBe('javascript');
    expect(detectLanguage('Foo.java')).toBe('java');
    expect(detectLanguage('foo.py')).toBe('python');
    expect(detectLanguage('foo.go')).toBe('go');
    expect(detectLanguage('foo.rs')).toBe('rust');
    expect(detectLanguage('unknown.xyz')).toBe('unknown');
  });

  it('isCodeFile 判断正确', () => {
    expect(isCodeFile('a.ts')).toBe(true);
    expect(isCodeFile('a.java')).toBe(true);
    expect(isCodeFile('a.xyz')).toBe(false);
    expect(isCodeFile('a.txt')).toBe(false);
  });

  it('extractSymbols 从 TypeScript 提取符号', () => {
    const code = `
export class UserController {
  async login() {}
}
export interface User { id: number; }
export type UserPreview = Pick<User, 'id'>;
export enum Role { Admin, User }
export function authenticate() {}
export const MAX_RETRY = 3;
`;
    const symbols = extractSymbols(code, 'typescript', 'test.ts');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('UserController');
    expect(names).toContain('User');
    expect(names).toContain('UserPreview');
    expect(names).toContain('Role');
    expect(names).toContain('authenticate');
    expect(names).toContain('MAX_RETRY');
  });

  it('extractSymbols 从 Java 提取符号', () => {
    const code = `public class OrderService {
  public Order createOrder(String userId) {}
}`;
    const symbols = extractSymbols(code, 'java', 'OrderService.java');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('OrderService');
    expect(names).toContain('createOrder');
  });

  it('extractSymbols 从 Python 提取符号', () => {
    const code = `class DataProcessor:
    def process_data(self):
        pass`;
    const symbols = extractSymbols(code, 'python', 'dp.py');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('DataProcessor');
    expect(names).toContain('process_data');
  });
});

// ── indexer 测试 ──
describe('indexer', () => {
  it('buildIndex 构建完整索引', async () => {
    const index = await buildIndex({ root: tmpProject });

    expect(index.version).toBe(INDEX_VERSION);
    expect(index.projectRoot).toBe(tmpProject);
    expect(index.stats.totalFiles).toBeGreaterThan(0);
    expect(index.stats.totalChunks).toBeGreaterThan(0);
    expect(index.chunks.length).toBeGreaterThan(0);
    expect(Object.keys(index.invertedIndex).length).toBeGreaterThan(0);

    // 确认不包含 node_modules 内容
    const hasNodeModulesFile = index.files.some((f) =>
      f.path.includes('node_modules'),
    );
    expect(hasNodeModulesFile).toBe(false);
  });

  it('saveIndex + loadIndex 持久化', async () => {
    const index = await buildIndex({ root: tmpProject });
    const savedPath = await saveIndex(index, tmpProject);
    expect(existsSync(savedPath)).toBe(true);

    expect(await hasIndex(tmpProject)).toBe(true);

    const loaded = await loadIndex(tmpProject);
    expect(loaded).not.toBeNull();
    expect(loaded!.stats.totalFiles).toBe(index.stats.totalFiles);
    expect(loaded!.chunks.length).toBe(index.chunks.length);
    expect(readFileSync(join(tmpProject, '.gitignore'), 'utf-8')).toContain(
      '.devtoolkit-index.json',
    );
    if (process.platform !== 'win32') {
      expect(statSync(savedPath).mode & 0o777).toBe(0o600);
    }
  });

  it('saveIndex 不重复写入 .gitignore 规则', async () => {
    const index = await buildIndex({ root: tmpProject });
    writeFileSync(join(tmpProject, '.gitignore'), 'dist\n');
    await saveIndex(index, tmpProject);
    await saveIndex(index, tmpProject);
    const lines = readFileSync(join(tmpProject, '.gitignore'), 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line === '.devtoolkit-index.json');
    expect(lines).toHaveLength(1);
  });

  it('loadIndex 版本不匹配返回 null', async () => {
    const index = await buildIndex({ root: tmpProject });
    index.version = '0.0.0-wrong';
    await saveIndex(index, tmpProject);

    const loaded = await loadIndex(tmpProject);
    expect(loaded).toBeNull();
  });

  it('索引包含中文关键词', async () => {
    const code = 'export const errorMsg = "认证失败"; // 用户登录错误';
    mkdirSync(join(tmpProject, 'i18n'), { recursive: true });
    writeFileSync(join(tmpProject, 'i18n', 'zh.ts'), code);

    const index = await buildIndex({ root: tmpProject });
    expect(index.invertedIndex['认证失败']).toBeDefined();
  });
});

// ── searcher 测试 ──
describe('searcher', () => {
  let index: SearchIndex;

  beforeEach(async () => {
    index = await buildIndex({ root: tmpProject });
  });

  it('搜索 login 返回 UserController 结果', () => {
    const results = searchCode(index, 'login', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const topResult = results[0];
    expect(topResult.chunk.file).toContain('UserController');
  });

  it('搜索用户认证（中文+语义）找到相关代码', () => {
    const results = searchCode(index, '用户认证 authenticate', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const hasController = results.some((r) =>
      r.chunk.file.includes('UserController'),
    );
    expect(hasController).toBe(true);
  });

  it('搜索 pagination 找到分页代码', () => {
    const results = searchCode(index, 'pagination 分页', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const hasPagination = results.some((r) =>
      r.chunk.file.includes('pagination'),
    );
    expect(hasPagination).toBe(true);
  });

  it('搜索符号名 paginate', () => {
    const results = searchCode(index, 'paginate', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const hasPaginate = results.some((r) =>
      r.matchedSymbols.includes('paginate'),
    );
    expect(hasPaginate).toBe(true);
  });

  it('搜索 Java createOrder', () => {
    const results = searchCode(index, 'createOrder', { limit: 5 });
    expect(results.length).toBeGreaterThan(0);
    const hasJavaFile = results.some((r) =>
      r.chunk.file.includes('OrderService'),
    );
    expect(hasJavaFile).toBe(true);
  });

  it('搜索 Python DataProcessor', () => {
    const results = searchCode(index, 'DataProcessor process_data', {
      limit: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    const hasPython = results.some((r) =>
      r.chunk.file.includes('data_processor'),
    );
    expect(hasPython).toBe(true);
  });

  it('无匹配时返回空数组', () => {
    const results = searchCode(index, 'zzzznotexistzzzz', { limit: 5 });
    expect(results).toEqual([]);
  });

  it('CodeSearcher 实例复用', () => {
    const searcher = new CodeSearcher(index);
    const r1 = searcher.search('login', { limit: 3 });
    const r2 = searcher.search('register', { limit: 3 });
    expect(r1.length).toBeGreaterThan(0);
    expect(r2.length).toBeGreaterThan(0);
  });
});

// ── explainer 测试 ──
describe('explainer', () => {
  it('formatResultsPlain 空结果返回提示', () => {
    const output = formatResultsPlain([], '/tmp');
    expect(output).toContain('未找到');
  });

  it('formatResultsPlain 有结果时正确格式化', async () => {
    const index = await buildIndex({ root: tmpProject });
    const results = searchCode(index, 'login', { limit: 3 });
    const output = formatResultsPlain(results, tmpProject);
    expect(output).toContain('UserController');
    expect(output).toContain('📄');
  });
});

describe('代码搜索 — 高级语法与忽略规则增强', () => {
  it('parseIgnoreFile 正确解析目录与通配符规则', async () => {
    const { parseIgnoreFile } = await import('../src/search/scanner.js');
    const parsed = parseIgnoreFile(
      ['# 注释', 'node_modules/', 'dist', '*.log', 'temp/*'].join('\n'),
    );

    expect(parsed.dirs.has('node_modules')).toBe(true);
    expect(parsed.dirs.has('dist')).toBe(true);
    expect(parsed.patterns.length).toBeGreaterThanOrEqual(2);
    expect(parsed.patterns.some((p) => p.test('error.log'))).toBe(true);
    expect(parsed.patterns.some((p) => p.test('temp/cache.json'))).toBe(true);
  });

  it('CodeSearcher 支持 path: 和 lang: 高级过滤语法', async () => {
    const index = await buildIndex({ root: tmpProject });
    const searcher = new CodeSearcher(index);

    // 限定 path
    const pathResults = searcher.search('login path:controllers');
    expect(pathResults.length).toBeGreaterThan(0);
    expect(pathResults.every((r) => r.chunk.file.includes('controllers'))).toBe(
      true,
    );

    // 限定 lang
    const langResults = searcher.search('login lang:typescript');
    expect(langResults.length).toBeGreaterThan(0);
    expect(langResults.every((r) => r.chunk.language === 'typescript')).toBe(
      true,
    );

    // 限定 kind:class
    const classResults = searcher.search('UserController kind:class');
    expect(classResults.length).toBeGreaterThan(0);
    expect(
      classResults.some((r) => r.chunk.symbols.includes('UserController')),
    ).toBe(true);
  });

  it('updateIndex 增量更新只重扫变动文件', async () => {
    const initialIndex = await buildIndex({ root: tmpProject });
    expect(initialIndex.stats.totalFiles).toBeGreaterThan(0);

    // 新增一个文件
    const newFilePath = join(tmpProject, 'src', 'models', 'Order.ts');
    writeFileSync(
      newFilePath,
      'export class Order { id: string; amount: number; }',
    );

    const updated = await updateIndex(initialIndex, { root: tmpProject });
    expect(updated.stats.totalFiles).toBe(initialIndex.stats.totalFiles + 1);
    expect(updated.files.some((f) => f.path.includes('Order.ts'))).toBe(true);

    const searcher = new CodeSearcher(updated);
    const results = searcher.search('Order');
    expect(results.some((r) => r.chunk.content.includes('amount'))).toBe(true);
  });
});

describe('混合检索 (Hybrid Search) 与语义相似度打分', () => {
  let index: SearchIndex;

  beforeEach(async () => {
    index = await buildIndex({ root: tmpProject });
  });

  it('支持 hybrid 模式下的概念近义词召回 (auth -> login/token)', () => {
    // 搜索概念词 'auth'，即使代码中只有 login / authenticate / token，也能通过混合打分排在前列
    const hybridResults = searchCode(index, 'auth', {
      mode: 'hybrid',
      limit: 5,
    });
    expect(hybridResults.length).toBeGreaterThan(0);
    expect(
      hybridResults.some((r) => r.chunk.file.includes('UserController')),
    ).toBe(true);
  });

  it('支持 exact 与 semantic 检索模式切换', () => {
    const exactResults = searchCode(index, 'login', {
      mode: 'exact',
      limit: 3,
    });
    const semanticResults = searchCode(index, '用户登录认证与令牌发放流程', {
      mode: 'semantic',
      limit: 3,
    });

    expect(exactResults.length).toBeGreaterThan(0);
    expect(exactResults[0].chunk.file).toContain('UserController');

    expect(semanticResults.length).toBeGreaterThan(0);
    expect(
      semanticResults.some((r) => r.chunk.file.includes('UserController')),
    ).toBe(true);
  });

  it('BM25 与向量余弦相似度融合打分返回合理归一化区间 (0 - 1)', () => {
    const results = searchCode(index, 'UserController login authenticate', {
      limit: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });
});
