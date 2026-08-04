## MODIFIED Requirements

### Requirement: 模板依赖配置

模板的 `package.json` SHALL 声明 `react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`typescript` 作为开发依赖。不依赖 `@localapp/client` npm 包（SDK 以源码形式内嵌）。

#### Scenario: 安装依赖
- **WHEN** 在 `init-repo/` 目录执行 `npm install`
- **THEN** 成功安装 react、react-dom、vite 等依赖，无报错

#### Scenario: 构建项目
- **WHEN** 在 `init-repo/` 目录执行 `npm run build`
- **THEN** 生成 `dist/` 目录，包含可运行的 `index.html`

## ADDED Requirements

### Requirement: Vite 代理配置

`vite.config.ts` SHALL 配置 dev server proxy，将 `/api` 和 `/serve` 路径的请求转发到 `.localapp/dev-config.json` 中配置的服务器地址。若配置文件不存在或读取失败，SHALL 不配置 proxy（静默跳过）。

#### Scenario: 有 dev-config 时代理生效
- **WHEN** `.localapp/dev-config.json` 存在且包含 `{ "serverUrl": "http://192.168.1.100:3000" }`
- **THEN** `npm run dev` 时 `/api/me` 请求被代理到 `http://192.168.1.100:3000/api/me`

#### Scenario: 无 dev-config 时不报错
- **WHEN** `.localapp/dev-config.json` 不存在
- **THEN** `npm run dev` 正常启动，不配置 proxy，API 请求走本地（会 404）

#### Scenario: 生产构建不受影响
- **WHEN** 执行 `npm run build`
- **THEN** 构建成功，不包含 proxy 配置（proxy 仅在 dev server 生效）

### Requirement: .gitignore 配置

模板 SHALL 包含 `.gitignore` 文件，排除 `.localapp/dev-config.json`（本地开发配置，含服务器地址）和 `node_modules/`、`dist/`。

#### Scenario: dev-config 不被提交
- **WHEN** `.localapp/dev-config.json` 存在且执行 `git status`
- **THEN** 该文件不在未跟踪文件列表中（被 gitignore 排除）
