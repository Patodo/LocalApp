## ADDED Requirements

### Requirement: 浏览历史页面

`/my/recent` 页面 SHALL 展示当前用户的全部浏览历史记录，按访问时间倒序排列。

#### Scenario: 有历史时显示列表
- **WHEN** 用户访问 `/my/recent` 且用户有浏览历史
- **THEN** 页面显示历史列表，每行包含页面路径和访问时间（相对时间格式）

#### Scenario: 无历史时显示空状态
- **WHEN** 用户访问 `/my/recent` 且用户没有浏览历史
- **THEN** 页面显示空状态提示"暂无浏览记录"

#### Scenario: 点击历史条目跳转
- **WHEN** 用户点击某条历史记录
- **THEN** 浏览器跳转到该页面

### Requirement: 浏览历史数据获取

页面 SHALL 通过 `GET /api/me/recent` 获取数据（不传 limit，获取全部）。

#### Scenario: 数据加载中
- **WHEN** 页面正在加载数据
- **THEN** 显示"加载中..."提示
