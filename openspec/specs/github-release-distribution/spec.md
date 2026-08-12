## Purpose

定义 npm registry 的单包发行真源、包内 artifact manifest 完整性、固定版本安装，以及从相同版本发布 GHCR Server 镜像的可验证构建要求。

## Requirements

### Requirement: npm tgz 是唯一用户发行物

每个正式版本 SHALL 发布一个名为 `localapp` 的 npm package version。不得另行发布独立
CLI、桌面安装器、托盘程序或用户可安装的 Server artifact。

#### Scenario: 发布正式版本

- **WHEN** 维护者推送符合发行规则的版本 tag
- **THEN** workflow SHALL 从同一已通过 CI 的 commit 构建并验证 `localapp-<version>.tgz`
- **AND** SHALL 将相同版本发布到 npm registry

### Requirement: 包内 artifact manifest 可验证

npm tgz 的 artifact manifest MUST 记录 Server/Web/template 与各平台 native adapter 的
版本、路径、字节大小、SHA-256 和适用平台，并在发布前通过 schema 与内容校验。

#### Scenario: 清单覆盖包内资产

- **WHEN** release workflow 准备发布 tgz
- **THEN** 每个声明资产 SHALL 恰有一个匹配条目
- **AND** 文件大小与 SHA-256 SHALL 与 tgz 内容一致

### Requirement: Server 镜像发布到 GHCR

正式容器镜像 SHALL 使用版本 tag 和不可变 commit SHA tag 推送到 GHCR，并从同一
`localapp` 包的前台入口运行 Server。镜像 SHALL NOT 包含桌面 adapter 或注册秘密。

#### Scenario: 构建正式镜像

- **WHEN** release workflow 构建 Server 镜像
- **THEN** GHCR SHALL 存在版本 tag 与 commit SHA tag
- **AND** 镜像 SHALL 运行 `localapp server run` 等价入口

### Requirement: 安装方使用 npm 完整性机制

安装说明 SHALL 使用 npm 安装固定版本；包下载、integrity 校验和原子安装由 npm
完成。daemon 另外 SHALL 校验包内 native adapter 的 artifact digest。

#### Scenario: npm integrity 不匹配

- **WHEN** registry 返回的 tgz 与 lock/integrity 元数据不一致
- **THEN** npm SHALL 中止安装且现有 LocalApp 安装保持不变
