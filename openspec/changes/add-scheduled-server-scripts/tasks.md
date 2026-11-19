## 1. 调度与授权

- [x] 1.1 [RED] 编写统一 Server 定时执行、授权及超时的失败测试。
- [x] 1.2 [GREEN] 实现运维配置、定时执行和任务访问接口。
- [x] 1.3 [REFACTOR] 复用账号、用户组、认证及进程树清理能力。

## 2. 运维文档

- [x] 2.1 记录服务器配置、部署边界和程序化操作流程。

## 3. 端到端集成验证

| Spec Scenario | E2E Test | Status |
|---|---|---|
| scheduled-server-scripts > Scenario: 缺省时禁用 | scheduled-scripts.test.ts | ✓ |
| scheduled-server-scripts > Scenario: 使用固定输入执行 | scheduled-scripts.test.ts | ✓ |
| scheduled-server-scripts > Scenario: 到达开放和关闭时点 | scheduled-scripts.test.ts | ✓ |
| scheduled-server-scripts > Scenario: 运行超时 | scheduled-scripts.test.ts | ✓ |
| scheduled-server-scripts > Scenario: 用户权限变更 | scheduled-scripts.test.ts | ✓ |
| scheduled-server-scripts > Scenario: 缺少手动触发凭据 | scheduled-scripts.test.ts | ✓ |

- [x] 3.1 [GREEN] 为 scheduled-server-scripts > Scenario: 缺省时禁用 验证启动后 API 不可用。
- [x] 3.2 [GREEN] 为 scheduled-server-scripts > Scenario: 使用固定输入执行 验证调用接口与实进程输入。
- [x] 3.3 [GREEN] 为 scheduled-server-scripts > Scenario: 到达开放和关闭时点 验证 Server 调度与模型调用次数。
- [x] 3.4 [GREEN] 为 scheduled-server-scripts > Scenario: 运行超时 验证进程树退出和后续执行。
- [x] 3.5 [GREEN] 为 scheduled-server-scripts > Scenario: 用户权限变更 验证通过组管理 API 撤回任务操作权限。
- [x] 3.6 [GREEN] 为 scheduled-server-scripts > Scenario: 缺少手动触发凭据 验证程序化触发被拒绝。
