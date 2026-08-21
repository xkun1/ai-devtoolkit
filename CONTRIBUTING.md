## 🤝 参与贡献

感谢你对 devtoolkit 的兴趣！以下是如何参与贡献的简明指南。

### 🛠 开发环境

```bash
git clone https://github.com/xkun1/ai-devtoolkit.git
cd devtoolkit
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
   npm run test:coverage # 单元测试与覆盖率门槛
   npm run test:e2e    # Chromium Web UI 端到端测试
   npm run build       # 构建
   ```
3. 提交代码（pre-commit hook 会自动跑 lint-staged）
4. 提交 PR，描述变更原因和影响

### 📝 提交规范（Conventional Commits）

使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 格式，描述可用中文或英文：

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
- 默认测试必须完全离线、可重复，不允许依赖公网可用性
- Web UI 交互变更需补充 `e2e/` 下的 Playwright 测试
- 首次运行浏览器测试前执行 `npx playwright install chromium`

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
`prepublishOnly` 脚本会自动执行 UI 产物校验、类型检查、Lint、格式检查、构建、覆盖率测试、浏览器 E2E 与发布包检查。
