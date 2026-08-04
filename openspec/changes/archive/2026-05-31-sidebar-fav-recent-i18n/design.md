## Context

首页已通过 `/api/me/favorites?limit=5` 和 `/api/me/recent?limit=5` 展示收藏和浏览历史的预览（各 5 条）。后端 API 已支持不传 limit 或传更大 limit 获取全部数据。现在需要独立列表页和正确的导航入口。

## Goals / Non-Goals

**Goals:**
- 新建 `/my/favorites` 和 `/my/recent` 两个独立列表页
- 侧边栏添加对应入口
- 修复首页 "View all" 链接错误
- 隐藏 ThemeToggle 浮动按钮
- 全 UI 文本中文硬编码替换

**Non-Goals:**
- 不引入 i18n 框架（next-intl、react-i18next 等）
- 不实现收藏的批量操作
- 不修改后端 API（已有接口满足需求）
- 不删除 ThemeToggle 组件文件（仅从 layout 中移除渲染）

## Decisions

### 1. 收藏列表页交互

采用与首页类似的列表布局，每行显示页面名称 + 收藏时间。每行提供"取消收藏"按钮（星标图标），点击后调用 `DELETE /api/favorites/:pagePath` 并从列表移除。

### 2. 浏览历史页交互

简单列表，每行显示页面路径 + 访问时间。点击跳转到对应页面。不需要"清除历史"功能。

### 3. 侧边栏入口位置

放在 Personal 分区，`Groups` 之后：

```
Personal
  个人资料    /my/info
  我的应用    /my/apps
  API 密钥   /my/keys
  我的群组    /my/groups
  我的收藏    /my/favorites
  浏览历史    /my/recent
```

### 4. 中文硬编码策略

直接在 JSX 中替换英文字符串为中文。对于重复出现的文案（如 "加载中..."、"暂无数据"），不需要提取常量，各处独立硬编码即可。

## Risks / Trade-offs

- **硬编码中文不可逆** → 如果未来需要多语言，需要全面重构。当前用户群体确定纯中文，可接受。
- **ThemeToggle 仅隐藏不删除** → 未来需要暗黑模式时恢复方便。
