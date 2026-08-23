#!/usr/bin/env node

/**
 * 核心模块性能基准。
 *
 * 基准只使用临时生成的小型项目，不读取或修改当前仓库中的索引、缓存文件。
 * 运行前需要先执行 `npm run build`，脚本故意从 dist/ 动态加载产物，以便验证
 * 发布构建后的真实运行性能。
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_FILE_COUNT = Number(process.env.BENCH_FILES || 400);
const REPEATS = 10;

function formatMs(value) {
  return `${value.toFixed(2)} ms`;
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return {
    average,
    p50,
    p95,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function measure(task, repeats = REPEATS) {
  // 首次运行可能包含文件系统和模块的冷启动开销，先预热一次再统计。
  await task();
  const samples = [];
  for (let index = 0; index < repeats; index += 1) {
    const start = performance.now();
    await task();
    samples.push(performance.now() - start);
  }
  return summarize(samples);
}

async function createMockProject() {
  const root = await mkdtemp(join(tmpdir(), 'ai-devtoolkit-bench-'));
  await mkdir(join(root, 'src', 'features'), { recursive: true });
  await mkdir(join(root, 'src', 'shared'), { recursive: true });

  const shared = `export interface User { id: string; name: string; }\n\nexport function formatUser(user: User): string {\n  return user.name.trim();\n}\n`;
  const service = `import { User, formatUser } from '../shared/user.js';\n\nexport class UserService {\n  findUser(id: string): User {\n    return { id, name: formatUser({ id, name: 'Demo User' }) };\n  }\n}\n`;
  await writeFile(join(root, 'src', 'shared', 'user.ts'), shared);
  await writeFile(join(root, 'src', 'features', 'user-service.ts'), service);

  for (let index = 0; index < PROJECT_FILE_COUNT - 3; index += 1) {
    const dependency = index % 2 === 0 ? './shared/user.js' : './features/user-service.js';
    const vocabulary = Array.from(
      { length: 10 },
      (_, word) => `domain${index}Capability${word}`,
    ).join(' ');
    const source = `import { UserService } from '${dependency}';\n\n// ${vocabulary}\nexport function feature${index}(input: string): string {\n  const service = new UserService();\n  return service.findUser(input).name + ' feature-${index}';\n}\n`;
    await writeFile(join(root, 'src', `feature-${index}.ts`), source);
  }

  // 让扫描器同时覆盖另一种语言，避免基准只反映单一文件类型。
  await writeFile(
    join(root, 'src', 'shared', 'helpers.py'),
    'def normalize_name(value):\n    return value.strip().lower()\n',
  );
  return root;
}

async function main() {
  const projectRoot = await createMockProject();
  try {
    const distPath = join(
      fileURLToPath(new URL('..', import.meta.url)),
      'dist',
      'index.mjs',
    );
    const {
      buildIndex,
      CodeSearcher,
      searchCode,
      buildDependencyGraph,
      generateRepoMap,
    } = await import(pathToFileURL(distPath).href);

    let index;
    const indexBuild = await measure(async () => {
      index = await buildIndex({ root: projectRoot, maxDepth: 5 });
    }, 3);

    const construction = await measure(() => new CodeSearcher(index));
    const searcher = new CodeSearcher(index);
    const hotSearch = await measure(() => {
      searcher.search('user service feature', { limit: 10 });
    });
    searchCode(index, 'user service feature', { limit: 10 });
    const cachedApiSearch = await measure(() =>
      searchCode(index, 'user service feature', { limit: 10 }),
    );

    let dependencyGraph;
    const graph = await measure(async () => {
      dependencyGraph = await buildDependencyGraph({
        root: projectRoot,
        maxDepth: 5,
        useCache: false,
      });
    });

    let repoMap;
    const repoMapBuild = await measure(async () => {
      repoMap = await generateRepoMap({ root: projectRoot, maxChars: 20_000 });
    });

    const rows = [
      ['索引构建（buildIndex）', indexBuild, `${index.stats.totalFiles} 文件 / ${index.stats.totalChunks} 分块`],
      ['搜索器构建（CodeSearcher）', construction, `${Object.keys(index.invertedIndex).length} 个关键词`],
      ['热搜索（CodeSearcher.search）', hotSearch, `${searcher.search('user service feature', { limit: 10 }).length} 条结果`],
      ['公共 API 缓存搜索（searchCode）', cachedApiSearch, '复用同一索引搜索器'],
      [
        '依赖分析（buildDependencyGraph）',
        graph,
        `${dependencyGraph.stats.totalFiles} 节点 / ${dependencyGraph.stats.totalEdges} 边`,
      ],
      ['Repo Map 生成（generateRepoMap）', repoMapBuild, `${repoMap.length} 字符`],
    ];

    console.log(`基准项目：${PROJECT_FILE_COUNT} 个核心代码文件，搜索重复 ${REPEATS} 次（预热 1 次）`);
    console.log('');
    console.log('| 模块 | 平均 | P50 | P95 | 最小 | 最大 | 工作量 |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    for (const [name, result, workload] of rows) {
      console.log(
        `| ${name} | ${formatMs(result.average)} | ${formatMs(result.p50)} | ${formatMs(result.p95)} | ${formatMs(result.min)} | ${formatMs(result.max)} | ${workload} |`,
      );
    }
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`基准执行失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
