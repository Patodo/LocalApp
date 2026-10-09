# 实施任务

## 1. 环境验证
- [x] 1.1 [RED] 编写隔离、网络与依赖脚本越界失败测试
- [ ] 1.2 [GREEN] 实现隔离构建执行器、资源额度与系统检查
- [ ] 1.3 [REFACTOR] 整理环境配置与平台可用性
- [ ] 1.4 各 RED、GREEN、REFACTOR 阶段结束后分别提交并记录结果

## 2. 项目源码
- [x] 2.1 [RED] 编写权限、路径、并发与版本恢复失败测试
- [x] 2.2 [GREEN] 实现项目存储、模板、源码历史、文件 API 与写入锁
- [ ] 2.3 [REFACTOR] 整理项目服务与资源回收
- [ ] 2.4 各 RED、GREEN、REFACTOR 阶段结束后分别提交并记录结果

## 3. 开发界面与 Agent
- [ ] 3.1 [RED] 编写模型切换、开发权限与写入锁失败测试
- [x] 3.2 [GREEN] 实现项目 dsh 会话、开发 Skills、文件编辑、改动与对话界面
- [ ] 3.3 [REFACTOR] 整理事件复用、shadcn/ui、窄屏与无障碍
- [ ] 3.4 各 RED、GREEN、REFACTOR 阶段结束后分别提交并记录结果

## 4. 构建与预览
- [x] 4.1 [RED] 编写固定输入、取消重启与预览隔离失败测试
- [x] 4.2 [GREEN] 实现共用 CLI 检查打包模块、构建日志与独立 origin 预览
- [ ] 4.3 [REFACTOR] 整理任务恢复与预览清理
- [ ] 4.4 各 RED、GREEN、REFACTOR 阶段结束后分别提交并记录结果

## 5. 发布
- [ ] 5.1 [RED] 编写权限、产物对应、竞争、幂等与失败失败测试
- [x] 5.2 [GREEN] 实现显式发布、来源记录与现有 installer 集成
- [ ] 5.3 [REFACTOR] 整理发布诊断与恢复操作界面
- [ ] 5.4 各 RED、GREEN、REFACTOR 阶段结束后分别提交并记录结果

## 6. 后续阶段（第一阶段闭环通过后实施）
- [ ] 6.1 补充导入导出、应用关联、备份恢复、多人工作区、冲突与外部 Git 同步规格和 E2E 场景
- [ ] 6.2 [RED] 编写源码可移植性、多人权限、合并与凭据隔离失败测试
- [ ] 6.3 [GREEN] 实现导入导出、备份恢复、应用关联、多人工作区与可选外部 Git 同步
- [ ] 6.4 [REFACTOR] 整理来源检查、合并冲突与凭据管理
- [ ] 6.5 各阶段结束后分别提交并验证

## 7. 第一阶段端到端验收

| Spec Scenario | E2E Test | Status |
| --- | --- | --- |
| platform-app-development > Scenario: 模板创建项目 | development-1 | ✗ |
| platform-app-development > Scenario: 开发权限隔离 | development-2 | ✗ |
| platform-app-development > Scenario: 文件并发保护 | development-3 | ✗ |
| platform-app-development > Scenario: 开发模型切换 | development-4 | ✗ |
| platform-app-development > Scenario: 源码历史恢复 | development-5 | ✗ |
| platform-app-development > Scenario: 环境不可用 | development-6 | ✗ |
| platform-app-development > Scenario: 隔离命令与依赖安装 | development-7 | ✗ |
| platform-app-development > Scenario: 固定源码构建 | development-8 | ✗ |
| platform-app-development > Scenario: 取消与重启 | development-9 | ✗ |
| platform-app-development > Scenario: 独立预览数据 | development-10 | ✗ |
| platform-app-development > Scenario: 独立预览来源 | development-11 | ✗ |
| platform-app-development > Scenario: 明确发布 | development-12 | ✗ |
| platform-app-development > Scenario: 发布竞争与失败 | development-13 | ✗ |
| platform-app-development > Scenario: 正式入口验收 | development-14 | ✗ |

- [ ] 7.1 [GREEN] 为 platform-app-development > Scenario: 模板创建项目 编写 e2e 测试
- [ ] 7.2 [GREEN] 为 platform-app-development > Scenario: 开发权限隔离 编写 e2e 测试
- [ ] 7.3 [GREEN] 为 platform-app-development > Scenario: 文件并发保护 编写 e2e 测试
- [ ] 7.4 [GREEN] 为 platform-app-development > Scenario: 开发模型切换 编写 e2e 测试
- [ ] 7.5 [GREEN] 为 platform-app-development > Scenario: 源码历史恢复 编写 e2e 测试
- [ ] 7.6 [GREEN] 为 platform-app-development > Scenario: 环境不可用 编写 e2e 测试
- [ ] 7.7 [GREEN] 为 platform-app-development > Scenario: 隔离命令与依赖安装 编写 e2e 测试
- [ ] 7.8 [GREEN] 为 platform-app-development > Scenario: 固定源码构建 编写 e2e 测试
- [ ] 7.9 [GREEN] 为 platform-app-development > Scenario: 取消与重启 编写 e2e 测试
- [ ] 7.10 [GREEN] 为 platform-app-development > Scenario: 独立预览数据 编写 e2e 测试
- [ ] 7.11 [GREEN] 为 platform-app-development > Scenario: 独立预览来源 编写 e2e 测试
- [ ] 7.12 [GREEN] 为 platform-app-development > Scenario: 明确发布 编写 e2e 测试
- [ ] 7.13 [GREEN] 为 platform-app-development > Scenario: 发布竞争与失败 编写 e2e 测试
- [ ] 7.14 [GREEN] 为 platform-app-development > Scenario: 正式入口验收 编写 e2e 测试
- [ ] 7.15 在仓库 tmp/ 创建项目与 Server 数据，执行 E2E 并逐项更新映射表
- [ ] 7.16 从正式应用入口集成验证，记录结果和平台限制
- [ ] 7.17 后续阶段实施时追加逐场景 E2E 与映射表并执行


## 当前提交记录

- 方案：a95f94b。
- 项目存储 RED / GREEN：0a249f3 / 10a7f62；存储整理与实际路径隔离检查：8a8ad0e。
- 工作目录隔离 RED：896e64f；固定构建与重启 RED：e6f8161。
- Server 开发 API、构建、预览与发布第一版：3de9e76。
- dsh 界面组件、开发页面与管理员环境页：28af9a8。
- 未完成阶段继续保留未勾选状态；真实模板完整构建和第一阶段总体验收尚未通过，不能归档此变更。
