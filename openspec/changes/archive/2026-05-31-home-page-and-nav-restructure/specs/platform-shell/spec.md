## MODIFIED Requirements

### Requirement: Navbar 组件

导航栏 SHALL 分为左右两个区域。左侧 SHALL 包含 Home 按钮（House 图标，链接到 `/`）、应用名称和 Issue 按钮。右侧 SHALL 包含收藏按钮（星标图标 + 收藏数量）、头像（已登录时）或登录按钮（未登录时）。导航栏 SHALL 固定在页面顶部。

#### Scenario: Home 按钮可见且功能正常
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏最左侧显示 House 图标按钮
- **THEN** 点击 Home 按钮跳转到 `/`

#### Scenario: Home 按钮不影响其他元素
- **WHEN** 应用名称较长
- **THEN** Home 按钮仍然可见，应用名称截断显示

#### Scenario: Issue 按钮可见
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏左侧显示 CircleDot 图标按钮（在 Home 按钮和应用名称之后）
- **THEN** 点击打开 Issue 模态框

#### Scenario: 收藏按钮显示星标数量
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏右侧显示星标图标 + 收藏数量
- **THEN** 点击收藏按钮切换收藏状态
