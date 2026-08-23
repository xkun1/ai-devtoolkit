import { version } from '../package.json';

/** 构建时内联 package.json 版本，避免依赖运行时工作目录。 */
export function readPackageVersion(): string {
  return typeof version === 'string' ? version : '0.0.0';
}

export const PACKAGE_VERSION = readPackageVersion();
