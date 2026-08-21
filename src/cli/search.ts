import type { Command } from 'commander';

/** 注册代码搜索、依赖图谱与影响面分析选项。 */
export function register(program: Command): void {
  program
    .option(
      '--scan-code',
      '扫描当前项目代码并构建搜索索引（之后可用 --search 或交互式搜索）',
    )
    .option('--search <query>', '用自然语言搜索项目代码')
    .option('--no-explain', '搜索结果不使用 LLM 解释（仅显示匹配的代码片段）')
    .option('--graph', '分析当前项目的代码依赖关系并生成 Mermaid 架构拓扑图')
    .option('--no-cache', '禁用依赖图谱增量分析缓存，执行全量静态分析')
    .option(
      '--search-mode <mode>',
      '代码搜索模式: hybrid (默认) | exact | semantic',
    )
    .option(
      '--impact <file>',
      '分析修改指定文件所波及的所有直接与间接上游依赖链路',
    )
    .option('--repo-map', '生成项目 Repo Map（项目结构摘要）');
}
