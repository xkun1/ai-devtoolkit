import type { Command } from 'commander';
import { parseInteger } from './parse.js';

/** 注册 Web UI 与 MCP Server 相关选项。 */
export function register(program: Command): void {
  program
    .option('--ui', '启动 Web UI 界面（仅监听本机）')
    .option('--port <n>', 'Web UI 端口号（1-65535，默认 3456）', (value) =>
      parseInteger(value, 'port', 1, 65535),
    )
    .option('--mcp', '启动 MCP Server（stdio JSON-RPC，供 AI Agent 直接调用）');
}
