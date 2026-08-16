import { expect, test } from '@playwright/test';

test('Web UI 首页、页签与规则转换链路可用', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-frame-options']).toBe('DENY');
  expect(response?.headers()['content-security-policy']).toContain(
    "frame-ancestors 'none'",
  );

  await expect(page).toHaveTitle(/devtoolkit/);
  await expect(page.locator('#panel-skills')).toBeVisible();
  await expect(page.locator('#modelSelect option')).not.toHaveCount(0);

  await page.locator('#tabBtnConvert').click();
  await expect(page.locator('#panel-convert')).toBeVisible();
  await expect(page.locator('#panel-skills')).toBeHidden();

  await page.locator('#convertInput').fill(`---
name: browser-e2e
description: 浏览器端到端测试规则
---

# 浏览器测试规则

所有变更必须经过自动化测试。`);
  await page.locator('#startConvertBtn').click();
  await expect(page.locator('#convertResultCard')).toBeVisible();
  await expect(page.locator('#convertPreview')).toContainText('browser-e2e');
  expect(pageErrors).toEqual([]);
});
