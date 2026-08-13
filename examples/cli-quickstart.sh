#!/bin/bash
# devtoolkit CLI 快速参考

# ─── 基础用法 ───

# 从 URL 生成 Codex 技能
npx ai-devtoolkit https://docs.example.com/api

# 从 PDF 生成 Cursor 规则
npx ai-devtoolkit ./guide.pdf --type cursor

# ─── 多文档合并 ───
npx ai-devtoolkit ./api.md ./sdk.md ./errors.md --type codex

# ─── 预览（不写文件）───
npx ai-devtoolkit ./api.md --dry-run

# ─── stdout 管道模式 ───
npx ai-devtoolkit ./api.md --stdout | grep "##"

# ─── 自定义输出路径 ───
npx ai-devtoolkit ./api.md --out ./skills/stripe.md

# ─── 强制覆盖 ───
npx ai-devtoolkit ./api.md --force

# ─── 使用 OpenAI ───
npx ai-devtoolkit ./api.md --model gpt-4o --api-key sk-xxx

# ─── 交互式向导 ───
npx ai-devtoolkit
