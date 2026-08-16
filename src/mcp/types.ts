export interface McpServerOptions {
  model?: string;
  baseURL?: string;
  apiKey?: string;
  localModelName?: string;
  /** 单个 MCP 工具请求总超时，默认 5 分钟。 */
  requestTimeoutMs?: number;
  /** 单次 LLM 调用超时，默认 120 秒。 */
  llmTimeoutMs?: number;
  /** 工具文本结果最大字节数，默认 1 MiB。 */
  maxToolResultBytes?: number;
  /** 单次 LLM 响应字符上限，默认 1 MiB。 */
  maxOutputChars?: number;
  /** 单次模型响应最大 Token 数，默认 8192。 */
  maxOutputTokens?: number;
}

export interface McpToolContext {
  defaults: McpServerOptions;
  signal: AbortSignal;
  llmTimeoutMs: number;
  maxOutputChars: number;
  maxOutputTokens: number;
}
