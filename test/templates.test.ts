/**
 * 模板市场测试
 */
import { describe, it, expect } from 'vitest';
import {
  TEMPLATES,
  getTemplate,
  listTemplates,
  isValidTemplate,
  listTemplatesByCategory,
} from '../src/templates/index.js';

describe('模板市场', () => {
  it('内置模板数量 >= 5', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
  });

  it('包含 default 模板', () => {
    const t = getTemplate('default');
    expect(t).toBeDefined();
    expect(t!.category).toBe('general');
  });

  it('包含 api-doc 模板', () => {
    const t = getTemplate('api-doc');
    expect(t).toBeDefined();
    expect(t!.category).toBe('api');
    expect(t!.promptSuffix).toContain('endpoint');
  });

  it('包含 cheatsheet 模板', () => {
    const t = getTemplate('cheatsheet');
    expect(t).toBeDefined();
    expect(t!.promptSuffix).toContain('concise');
  });

  it('isValidTemplate 正确校验', () => {
    expect(isValidTemplate('default')).toBe(true);
    expect(isValidTemplate('api-doc')).toBe(true);
    expect(isValidTemplate('nonexistent')).toBe(false);
  });

  it('listTemplates 返回全部', () => {
    const list = listTemplates();
    expect(list.length).toBe(TEMPLATES.length);
  });

  it('listTemplatesByCategory 按分类分组', () => {
    const grouped = listTemplatesByCategory();
    expect(grouped.general).toBeDefined();
    expect(grouped.api).toBeDefined();
    expect(grouped.general.length).toBeGreaterThan(0);
  });

  it('每个模板有必填字段', () => {
    for (const t of TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(['api', 'coding', 'project', 'reference', 'general']).toContain(
        t.category,
      );
    }
  });
});
