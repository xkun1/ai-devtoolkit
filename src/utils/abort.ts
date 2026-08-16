/** 长任务取消、超时与资源上限的统一错误类型。 */
export class OperationAbortedError extends Error {
  readonly code = 'ERR_OPERATION_ABORTED';

  constructor(message = '操作已取消', options?: ErrorOptions) {
    super(message, options);
    this.name = 'AbortError';
  }
}

export class OperationTimeoutError extends Error {
  readonly code = 'ERR_OPERATION_TIMEOUT';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TimeoutError';
  }
}

export class ResourceLimitError extends Error {
  readonly code = 'ERR_RESOURCE_LIMIT';

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ResourceLimitError';
  }
}

export interface AbortScope {
  signal: AbortSignal;
  dispose: () => void;
}

/**
 * 将上游取消信号与本次操作超时合并；调用方必须在 finally 中 dispose。
 */
export function createAbortScope(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  label = '操作',
): AbortScope {
  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
  ) {
    throw new RangeError('timeoutMs 必须是正整数');
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortFromParent = () => {
    controller.abort(toAbortError(parentSignal?.reason, `${label}已取消`));
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  if (timeoutMs !== undefined && !controller.signal.aborted) {
    timer = setTimeout(() => {
      controller.abort(
        new OperationTimeoutError(`${label}超时（${timeoutMs}ms）`),
      );
    }, timeoutMs);
    timer.unref?.();
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
  };
}

/** 在同步边界快速响应取消。 */
export function throwIfAborted(
  signal: AbortSignal | undefined,
  label = '操作',
): void {
  if (!signal?.aborted) return;
  throw toAbortError(signal.reason, `${label}已取消`);
}

/** 统一判断不可降级吞掉的取消/超时错误。 */
export function isAbortError(error: unknown): boolean {
  return (
    error instanceof OperationAbortedError ||
    error instanceof OperationTimeoutError ||
    (error instanceof Error &&
      (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

/** 可取消的等待，用于重试退避。 */
export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(toAbortError(signal?.reason, '操作已取消'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 将 AbortSignal.reason 规范化为可读错误。 */
export function toAbortError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) {
    return isAbortError(reason)
      ? reason
      : new OperationAbortedError(reason.message || fallback, {
          cause: reason,
        });
  }
  return new OperationAbortedError(
    typeof reason === 'string' && reason.trim() ? reason : fallback,
  );
}
