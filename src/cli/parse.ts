import { InvalidArgumentError } from 'commander';

/** Commander 数字选项的统一校验器，确保参数契约与旧版 CLI 一致。 */
export function parseInteger(
  value: string,
  label: string,
  min: number,
  max: number,
): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(`${label} 必须是整数`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new InvalidArgumentError(`${label} 必须在 ${min}-${max} 之间`);
  }
  return parsed;
}

/** Commander 枚举选项校验器。 */
export function parseChoice<const T extends readonly string[]>(
  value: string,
  label: string,
  choices: T,
): T[number] {
  if (!choices.includes(value)) {
    throw new InvalidArgumentError(
      `${label} 必须是以下值之一: ${choices.join(', ')}`,
    );
  }
  return value as T[number];
}
