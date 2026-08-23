# Token 节省 Benchmark

本文档用于复现 README 中“节省 80%~90% Token”的确定性结构化路径数据。

## 方法学

- **测量路径**：`src/loader/openapi.ts` 的 `parseOpenApiSpec` →
  `renderOpenApiToMarkdown`。该路径只做 YAML/JSON 解析、`$ref` 解引用和
  Markdown 渲染，不调用 LLM，因此结果可重复。
- **样本**：`scripts/benchmark.ts` 内联生成 3 个固定样本：两个 OpenAPI 3.0
  YAML（基础、中型）和一个 Swagger 2.0 YAML。每个样本包含真实 API 文档常见的
  路由、参数、请求/响应 Schema、示例、校验约束及 `x-*` 扩展。
- **字符数**：原始文档是脚本通过 `yaml.stringify` 生成的 YAML 字符串；产物是
  `renderOpenApiToMarkdown` 返回的 Markdown 字符串，均按 JavaScript
  `String.length` 统计。
- **Token 估算**：`估算 Token = ceil(字符数 / 4)`；节省率按
  `1 - 产物字符数 / 原始字符数` 计算。该值是跨模型的粗略估算，不代表某个
  特定 tokenizer 的精确计费值。
- **信息取舍**：结构化产物保留标题、服务地址、鉴权、路由、参数和核心字段，
  不重复携带示例数组、代码样例、校验约束和 `x-*` 扩展等冗余内容。这正是该
  加载器面向 Agent 上下文的压缩目标；不同文档的冗余程度会使实际节省率变化。

## 复现命令

在项目根目录执行：

```bash
npx tsx scripts/benchmark.ts
```

脚本不读网络、不需要 API Key，也不会写入临时文件。

## 结果

以下结果由上述命令于 2026-08-21 运行得到：

| 样本 | 规范 | 接口数 | 原始字符 | 产物字符 | 原始 Token（估算） | 产物 Token（估算） | 节省率 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| OpenAPI 3 基础（2 资源 / 8 接口） | OpenAPI 3.0 | 8 | 20,357 | 3,859 | 5,090 | 965 | **81.0%** |
| OpenAPI 3 中型（5 资源 / 20 接口） | OpenAPI 3.0 | 20 | 51,845 | 9,235 | 12,962 | 2,309 | **82.2%** |
| Swagger 2.0 兼容（6 资源 / 12 接口） | Swagger 2.0 | 12 | 41,729 | 5,466 | 10,433 | 1,367 | **86.9%** |

三个样本平均按字符数计算的节省率约为 **83.4%**。这组结果只证明确定性
OpenAPI/Swagger 结构化加载器的压缩效果；`pipeline.ts` 的 LLM 提炼路径依赖
外部 API Key，未在本 Benchmark 中真实调用，其效果会随模型、提示词、输入文档
和输出上限变化。

## 核心模块性能基准

### 方法

`scripts/benchmark.mjs` 在系统临时目录生成一个包含 400 个 TypeScript / Python
文件、4,000+ 关键词的 mock 项目，然后从 `dist/index.mjs` 动态加载发布构建，分别
测量索引构建、搜索器构建、热搜索、公共 API 缓存搜索、依赖分析和 Repo Map。
索引构建重复 3 次，其余项目先预热 1 次再重复 10 次；结果报告平均值、P50、P95、
最小值和最大值。依赖分析关闭持久化缓存（`useCache: false`），反映冷分析成本。

运行命令：

```bash
npm run build && npm run bench
```

### 最近一次结果

以下结果基于本机 2026-08-23 运行，机器负载和 Node.js 版本不同会导致数值变化；该表
用于持续追踪趋势，不作为跨机器的绝对性能承诺。

| 模块 | 平均 | P50 | P95 | 最小 | 最大 | 工作量 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 索引构建（buildIndex） | 60.42 ms | 59.74 ms | 61.89 ms | 59.63 ms | 61.89 ms | 400 文件 / 400 分块 |
| 搜索器构建（CodeSearcher） | 15.30 ms | 15.18 ms | 17.35 ms | 13.99 ms | 17.35 ms | 4,386 个关键词 |
| 热搜索（CodeSearcher.search） | 1.31 ms | 1.23 ms | 1.80 ms | 0.96 ms | 1.80 ms | 10 条结果 |
| 公共 API 缓存搜索（searchCode） | 1.00 ms | 0.94 ms | 1.47 ms | 0.92 ms | 1.47 ms | 复用同一索引搜索器 |
| 依赖分析（buildDependencyGraph） | 49.65 ms | 49.70 ms | 50.78 ms | 48.64 ms | 50.78 ms | 400 节点 / 398 边 |
| Repo Map 生成（generateRepoMap） | 45.79 ms | 46.09 ms | 47.67 ms | 44.55 ms | 47.67 ms | 20,016 字符 |
