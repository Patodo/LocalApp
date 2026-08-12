## Purpose

定义从单一 `localapp` npm 包以前台模式运行统一 Server 的生产容器要求，包括构建来源、系统集成排除、进程生命周期和秘密隔离边界。

## Requirements

### Requirement: 容器使用同一 npm Server 入口

生产镜像 SHALL 安装或组装与用户发行相同版本的 `localapp` npm 包，并通过
`localapp server run` 等价入口以前台模式运行。容器与个人 daemon SHALL 使用同一
Server 实现、配置模型、认证、权限、应用数据库和文件 API。

#### Scenario: 容器启动 Server

- **WHEN** 容器启动
- **THEN** SHALL 以前台模式输出结构化 readiness 并接受正常关闭信号

### Requirement: 容器不包含桌面系统集成

容器镜像 SHALL NOT 注册 `localapp://`、显示系统通知，或包含非目标运行平台的 native
adapter。镜像 SHALL NOT 包含独立 CLI 二进制、桌面安装器或旧发行压缩包。

#### Scenario: 检查生产镜像

- **WHEN** CI 扫描镜像文件系统
- **THEN** SHALL 不存在 Tauri/Desktop 资产、独立原生 CLI 或跨平台 adapter 集合
- **AND** Node 运行镜像 SHALL 不包含 Rust 工具链

### Requirement: Docker 构建不依赖预生成发行二进制

Docker 构建 SHALL 从已通过 CI 的源码或固定 npm tgz 构建 Server/Web 运行产物，不得
依赖仓库内手工维护的 CLI 下载目录。

#### Scenario: 从公开源码构建镜像

- **WHEN** 开发者从通过门禁的公开源码构建
- **THEN** 构建 SHALL 不需要预生成原生 CLI 或桌面产物

### Requirement: 镜像不包含注册秘密

生产镜像 MUST NOT 复制或生成共享 registration key、API Key、JWT secret 或 master key。

#### Scenario: 检查镜像层

- **WHEN** CI 扫描镜像文件系统和历史层
- **THEN** SHALL 不存在共享注册秘密或用户凭据
