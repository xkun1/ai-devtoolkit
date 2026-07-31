/**
 * 端到端测试：真实网页加载（不依赖 LLM，验证 loader 完整链路）
 * 注意：此测试需要网络访问，无网络时自动跳过
 */
import { describe, it, expect } from 'vitest';
import { loadFromUrl } from '../src/loader/url.js';

const isNetworkAvailable = async (): Promise<boolean> => {
  try {
    await fetch('https://example.com', { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
};

describe('URL Loader E2E', () => {
  it('成功加载并提取真实网页正文', async (context) => {
    if (!(await isNetworkAvailable())) {
      context.skip();
      return;
    }
    const doc = await loadFromUrl('https://example.com');
    expect(doc.type).toBe('url');
    expect(doc.content.length).toBeGreaterThan(10);
    expect(doc.title).toBeTruthy();
  }, 15000);
});
