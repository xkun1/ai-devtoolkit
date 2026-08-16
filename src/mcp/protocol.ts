export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  if (!isRecord(value) || value.jsonrpc !== '2.0') return false;
  if (typeof value.method !== 'string' || value.method.length === 0) {
    return false;
  }
  if (
    value.id !== undefined &&
    value.id !== null &&
    typeof value.id !== 'string' &&
    typeof value.id !== 'number'
  ) {
    return false;
  }
  return value.params === undefined || isRecord(value.params);
}

export function getRequestId(value: unknown): string | number | null {
  if (!isRecord(value)) return null;
  return typeof value.id === 'string' || typeof value.id === 'number'
    ? value.id
    : null;
}
