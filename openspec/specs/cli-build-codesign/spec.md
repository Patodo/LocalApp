## Purpose

定义单一 npm 发行物中 native adapter 的跨平台构建、签名、摘要校验和清单真实性，同时明确 TypeScript CLI 与统一 Server 不属于原生构建产物。

## Requirements

### Requirement: CLI 与 Server 由 npm 包提供

`localapp` CLI 和 Server SHALL 由 TypeScript/Node.js 构建，不得要求 Cargo 构建独立
CLI。平台原生工具链仅可用于构建包内 Scheme/通知 native adapter。

#### Scenario: 从 tgz 使用 CLI

- **WHEN** 在空目录安装 `localapp-<version>.tgz`
- **THEN** `node_modules/.bin/localapp --version` SHALL 成功
- **AND** SHALL NOT 依赖仓库源码或独立原生 CLI

### Requirement: 对应平台构建 native adapter

正式发行 SHALL 在 Linux、macOS 和 Windows 对应 runner 上构建、测试和打包该平台
adapter，不得以单平台产物伪装其它目标。

#### Scenario: 跨平台包构建完成

- **WHEN** 版本 tag 触发发行 workflow
- **THEN** 每个受支持目标的 adapter SHALL 由对应 runner 生成并通过协议 smoke test
- **AND** 每个目标最终仍 SHALL 生成同名、同版本的 `localapp` npm 包

### Requirement: 清单记录真实签名状态

artifact manifest MUST 记录 native adapter 的平台、架构、SHA-256 和真实签名状态。
缺少正式证书时 MUST NOT 把产物标记为正式签名。

#### Scenario: macOS ad-hoc 签名

- **WHEN** macOS runner 未配置 Developer ID 证书
- **THEN** adapter MAY 通过 ad-hoc codesign 验证
- **AND** 清单 SHALL 将签名状态记录为 `adhoc`

#### Scenario: 正式签名秘密缺失

- **WHEN** workflow 未获得某平台正式签名凭据
- **THEN** workflow SHALL 按发行策略明确标记未正式签名或阻止公开发布
