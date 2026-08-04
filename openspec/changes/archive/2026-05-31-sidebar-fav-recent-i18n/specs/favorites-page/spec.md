## ADDED Requirements

### Requirement: 收藏列表页面

`/my/favorites` 页面 SHALL 展示当前用户的全部收藏记录，按收藏时间倒序排列。

#### Scenario: 有收藏时显示列表
- **WHEN** 用户访问 `/my/favorites` 且用户有收藏记录
- **THEN** 页面显示收藏列表，每行包含页面名称和收藏时间（相对时间格式）
- **AND** 每行提供"取消收藏"按钮

#### Scenario: 无收藏时显示空状态
- **WHEN** 用户访问 `/my/favorites` 且用户没有任何收藏
- **THEN** 页面显示空状态提示"暂无收藏"

#### Scenario: 取消收藏
- **WHEN** 用户点击某条收藏的"取消收藏"按钮
- **THEN** 系统调用 `DELETE /api/favorites/:pagePath`，成功后该条目从列表中移除

#### Scenario: 点击收藏条目跳转
- **WHEN** 用户点击某条收藏的页面名称
- **THEN** 浏览器跳转到该页面

### Requirement: 收藏列表数据获取

页面 SHALL 通过 `GET /api/me/favorites` 获取数据（不传 limit，获取全部）。

#### Scenario: 数据加载中
- **WHEN** 页面正在加载数据
- **THEN** 显示"加载中..."提示
