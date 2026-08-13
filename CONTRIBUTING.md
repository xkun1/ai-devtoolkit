## 🤝 参与贡献

感谢你对 doc2skill 的兴趣！以下是如何参与贡献的简明指南。

### 🛠 开发环境

```bash
git clone https://github.com/xkun1/doc2skill.git
cd doc2skill
npm install
```

需要 Node.js >= 20.19。

### 📋 开发工作流

1. Fork 仓库并创建分支：`git checkout -b feat/your-feature`
2. 修改代码，确保通过以下检查：
   ```bash
   npm run typecheck   # 类型检查
   npm run lint        # ESLint
   npm run format:check # Prettier 格式
   npm test            # 单元测试
   npm run build       # 构建
   ```
3. 提交代码（pre-commit hook 会自动跑 lint-staged）
4. 提交 PR，描述变更原因和影响

### 📝 提交规范

使用中文提交信息，格式：

```
<type>: <描述>

<可选正文：变更原因和影响>
```

常用 type：
- `feat` 新功能
- `fix` Bug 修复
- `docs` 文档
- `refactor` 重构
- `test` 测试
- `chore` 构建/工具

### 🧪 测试指南

- 新功能必须附带测试
- 测试文件放在 `test/` 目录
- 不依赖网络的测试不应该需要 API Key
- E2E 测试在无网络时应该自动 skip

### 🐛 报告 Issue

提交 Issue 时请包括：
1. 复现步骤
2. 期望行为 vs 实际行为
3. 环境信息（Node 版本、操作系统、模型名）
4. 完整错误日志（`--verbose` 模式输出）

### 📦 发布流程（维护者）

```bash
npm version patch  # 或 minor / major
npm publish
git push --tags
```
`prepublishOnly` 脚本会自动执行 typecheck + build + test。
