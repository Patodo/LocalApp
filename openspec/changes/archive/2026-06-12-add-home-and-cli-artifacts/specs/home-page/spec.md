## ADDED Requirements

### Requirement: 公开首页入口

`/` 路径 SHALL 对未登录访问者渲染公开首页，不得自动重定向到 `/login`。公开首页 SHALL 使用 UTF-8 中文文案展示 LocalApp 的定位、主要使用流程、登录入口和 CLI release 产物目录说明。

#### Scenario: 未登录用户看到公开首页

- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面返回首页 HTML
- **THEN** 前端渲染 LocalApp 公开首页内容
- **THEN** 浏览器地址不得被自动替换为 `/login?redirect=/`

#### Scenario: 公开首页提供登录入口

- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面显示指向 `/login` 的登录入口
- **THEN** 页面显示 CLI release 目录说明

### Requirement: 登录后首页工作台体验

`/` 路径 SHALL 在检测到已登录用户后渲染中文工作台页面。页面 SHALL 展示欢迎语、我的应用、收藏应用和最近访问三个主要模块，并为每个模块提供查看全部入口。

#### Scenario: 已登录用户看到工作台

- **WHEN** 已登录用户访问 `GET /`
- **THEN** 页面显示可读的中文欢迎语和模块标题
- **THEN** 页面不得显示错误编码产生的乱码字符

#### Scenario: 工作台模块入口可用

- **WHEN** 已登录用户访问 `GET /`
- **THEN** 我的应用模块的查看全部入口指向 `/my/apps`
- **THEN** 收藏应用模块的查看全部入口指向 `/my/favorites`
- **THEN** 最近访问模块的查看全部入口指向 `/my/recent`

### Requirement: 首页模块独立容错

首页工作台的三个数据模块 SHALL 独立请求数据。任一模块请求失败时，页面 MUST 保持可用，并只在该模块内显示空状态或错误状态，不得阻塞其他模块渲染。

#### Scenario: 单个模块失败不影响首页

- **WHEN** 我的应用接口请求成功但收藏应用接口请求失败
- **THEN** 我的应用模块正常显示数据
- **THEN** 收藏应用模块显示空状态或错误状态
- **THEN** 最近访问模块继续独立加载或显示数据
