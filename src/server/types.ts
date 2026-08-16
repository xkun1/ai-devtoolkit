export interface ServerTaskLimits {
  signal: AbortSignal;
  llmTimeoutMs: number;
  maxOutputChars: number;
  maxOutputTokens: number;
}
