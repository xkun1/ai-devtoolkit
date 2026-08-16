/** MCP 工具元数据与输入 JSON Schema。 */

/** generate_skill 工具的 JSON Schema */
const GENERATE_SKILL_SCHEMA = {
  type: 'object' as const,
  properties: {
    sources: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 100,
      description:
        '文档来源列表：URL 或本地文件路径。支持 .md/.pdf/.docx/.html/.txt 等',
    },
    agentType: {
      type: 'string',
      enum: ['codex', 'cursor', 'claude'],
      description: '目标 AI Agent 类型（默认 codex）',
    },
    name: {
      type: 'string',
      description: '自定义技能名（用于技能包标识）',
    },
    template: {
      type: 'string',
      enum: [
        'default',
        'api-doc',
        'coding-guide',
        'project-rules',
        'cheatsheet',
        'sdk-guide',
      ],
      description: '预设模板 ID',
    },
    model: {
      type: 'string',
      description: 'LLM 模型名（默认 deepseek-chat）',
    },
    baseUrl: {
      type: 'string',
      description: 'LLM API Base URL',
    },
    apiKey: {
      type: 'string',
      description: 'API Key',
    },
    localModelName: {
      type: 'string',
      description: '本地模型真实名称',
    },
    outputPath: {
      type: 'string',
      description: '输出文件路径',
    },
    force: {
      type: 'boolean',
      description: '强制覆盖已存在的文件',
    },
    dryRun: {
      type: 'boolean',
      description: '预览结果，不写入文件',
    },
    timeoutMs: {
      type: 'integer',
      minimum: 1000,
      maximum: 600000,
      description: '单次 LLM 调用超时毫秒数',
    },
    maxOutputTokens: {
      type: 'integer',
      minimum: 1,
      maximum: 131072,
      description: '单次模型响应最大 Token 数（默认 8192）',
    },
    batchConcurrency: {
      type: 'integer',
      minimum: 1,
      maximum: 8,
      description: '目录批处理并发数（默认 2）',
    },
    maxBatchFiles: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: '目录批处理文件数上限（默认 100）',
    },
  },
  required: ['sources'],
};

/** scan_directory 工具的 JSON Schema */
const SCAN_DIRECTORY_SCHEMA = {
  type: 'object' as const,
  properties: {
    directory: {
      type: 'string',
      description: '要扫描的目录路径',
    },
    maxDepth: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: '最大递归深度（默认 5）',
    },
    maxFiles: {
      type: 'integer',
      minimum: 1,
      maximum: 10000,
      description: '最多扫描的文档文件数（默认 1000）',
    },
  },
  required: ['directory'],
};

/** scan_code 工具的 JSON Schema */
const SCAN_CODE_SCHEMA = {
  type: 'object' as const,
  properties: {
    directory: {
      type: 'string',
      description: '项目根目录路径（默认当前工作目录）',
    },
  },
  required: [] as const,
};

/** search_code 工具的 JSON Schema */
const SEARCH_CODE_SCHEMA = {
  type: 'object' as const,
  properties: {
    query: {
      type: 'string',
      description:
        '搜索查询：自然语言关键词、函数名、类名、path:src 等过滤语法',
    },
    directory: {
      type: 'string',
      description: '项目根目录路径（默认当前工作目录）',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: '返回结果数量上限（默认 10）',
    },
    explain: {
      type: 'boolean',
      description: '是否使用 LLM 解释搜索结果（默认 true）',
    },
  },
  required: ['query'],
};

/** convert_rule 工具的 JSON Schema */
const CONVERT_RULE_SCHEMA = {
  type: 'object' as const,
  properties: {
    ruleContent: {
      type: 'string',
      description:
        '规则原始 Markdown 或带 Frontmatter 的内容（与 rulePath 二选一）',
    },
    rulePath: {
      type: 'string',
      description: '本地规则文件路径（如 .cursor/rules/api.mdc 或 SKILL.md）',
    },
    to: {
      type: 'string',
      enum: ['cursor', 'codex', 'claude'],
      description: '转换目标 Agent 类型',
    },
    name: {
      type: 'string',
      description: '自定义规则名称',
    },
    outputDir: {
      type: 'string',
      description: '目标规则输出根目录（默认当前目录）',
    },
    write: {
      type: 'boolean',
      description: '是否直接写入目标路径（默认 false 只返回预览）',
    },
  },
  required: ['to'],
  oneOf: [{ required: ['ruleContent'] }, { required: ['rulePath'] }],
};

/** sync_rules 工具的 JSON Schema */
const SYNC_RULES_SCHEMA = {
  type: 'object' as const,
  properties: {
    projectRoot: {
      type: 'string',
      description: '项目根目录路径（默认当前工作目录）',
    },
    from: {
      type: 'string',
      enum: ['cursor', 'codex', 'claude', 'auto'],
      description: '同步源 Agent 规则（默认 auto 自动检测）',
    },
    to: {
      type: 'array',
      items: { type: 'string', enum: ['cursor', 'codex', 'claude'] },
      description: '同步目标 Agent 列表（默认同步到其他未配置的全部 Agent）',
    },
    dryRun: {
      type: 'boolean',
      description: '是否为 dry-run 预览模式（默认 true 不写入文件）',
    },
  },
  required: [] as const,
};

/** export_env 工具的 JSON Schema */
const EXPORT_ENV_SCHEMA = {
  type: 'object' as const,
  properties: {
    outputDir: {
      type: 'string',
      description: '快照与脚本保存目录（默认当前目录）',
    },
    outputPrefix: {
      type: 'string',
      description: '输出文件名前缀（默认 devtoolkit-env）',
    },
  },
  required: [] as const,
};

/** diff_env 工具的 JSON Schema */
const DIFF_ENV_SCHEMA = {
  type: 'object' as const,
  properties: {
    snapshotPath: {
      type: 'string',
      description: '环境快照 JSON 文件路径',
    },
  },
  required: ['snapshotPath'],
};

/** eval_skill 工具的 JSON Schema */
const EVAL_SKILL_SCHEMA = {
  type: 'object' as const,
  properties: {
    skillContent: {
      type: 'string',
      description: '待评测的技能正文（与 skillPath 二选一）',
    },
    skillPath: {
      type: 'string',
      description: '待评测的本地技能文件路径（与 skillContent 二选一）',
    },
    model: {
      type: 'string',
      description: '评测所用模型（默认继承 MCP Server 配置）',
    },
    baseUrl: {
      type: 'string',
      description: 'LLM API Base URL',
    },
    apiKey: {
      type: 'string',
      description: 'API Key',
    },
    localModelName: {
      type: 'string',
      description: '本地模型真实名称',
    },
    timeoutMs: {
      type: 'integer',
      minimum: 1000,
      maximum: 600000,
      description: '单次 LLM 调用超时毫秒数',
    },
    maxOutputTokens: {
      type: 'integer',
      minimum: 1,
      maximum: 131072,
      description: '单次模型响应最大 Token 数（默认 8192）',
    },
    concurrency: {
      type: 'integer',
      minimum: 1,
      maximum: 4,
      description: '评测用例并发数（默认 2）',
    },
    maxCases: {
      type: 'integer',
      minimum: 1,
      maximum: 20,
      description: '最多评测用例数（默认 20）',
    },
  },
  required: [] as const,
  oneOf: [{ required: ['skillContent'] }, { required: ['skillPath'] }],
};

/** 注册给 MCP Client 的工具列表 */
export const TOOLS = [
  {
    name: 'generate_skill',
    description:
      '将给定的文档 URL 或本地文件转化为 AI Agent（Codex/Cursor/Claude）的高质量技能包 / 规则文件。',
    inputSchema: GENERATE_SKILL_SCHEMA,
  },
  {
    name: 'scan_directory',
    description:
      '扫描指定目录下的所有可转换文档文件（.md, .pdf, .docx, .html 等），返回文件列表。',
    inputSchema: SCAN_DIRECTORY_SCHEMA,
  },
  {
    name: 'scan_code',
    description: '扫描指定项目的代码文件，提取符号和构建本地倒排搜索索引。',
    inputSchema: SCAN_CODE_SCHEMA,
  },
  {
    name: 'search_code',
    description:
      '用自然语言搜索项目代码（基于 TF-IDF + 符号/路径多路召回），返回高相关代码片段及智能解释。',
    inputSchema: SEARCH_CODE_SCHEMA,
  },
  {
    name: 'convert_rule',
    description:
      '在 Cursor (.mdc)、Codex (SKILL.md)、Claude (CLAUDE.md) 之间双向无损互转规则。',
    inputSchema: CONVERT_RULE_SCHEMA,
  },
  {
    name: 'sync_rules',
    description:
      '自动扫描项目已存在的 Agent 规则，并一键同步分发到其他 Agent 平台（Cursor/Codex/Claude）。',
    inputSchema: SYNC_RULES_SCHEMA,
  },
  {
    name: 'export_env',
    description:
      '扫描当前开发环境（Homebrew / npm / pip / SDK / VSCode 等），生成环境快照 JSON 和一键恢复脚本。',
    inputSchema: EXPORT_ENV_SCHEMA,
  },
  {
    name: 'diff_env',
    description:
      '比对当前机器环境与指定环境快照 JSON 的差异（缺失包、多出包、版本不匹配）。',
    inputSchema: DIFF_ENV_SCHEMA,
  },
  {
    name: 'eval_skill',
    description:
      '对 AI 技能执行带技能与无技能基线对照评测，返回量化报告和改进建议。',
    inputSchema: EVAL_SKILL_SCHEMA,
  },
];
