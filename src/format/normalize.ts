/** 统一清理 Agent Markdown：收敛尾部空行并确保单个换行结尾。 */
export function normalizeMarkdown(content: string): string {
  return content.replace(/\n{3,}$/g, '\n\n').trim() + '\n';
}
