## NEW Requirements

### Requirement: 运营大盘页面
管理面板 SHALL 包含运营大盘页面，用图表展示系统运行趋势。

#### Scenario: 访问运营大盘
- **WHEN** admin 访问 `/admin/analytics`
- **THEN** 展示以下图表区域：
  - 请求量趋势折线图（按天，可选 1d/7d/30d）
  - 页面访问排行（Top 10 表格）
  - 用户注册趋势柱状图（按天）
  - 页面浏览趋势折线图（按天）

#### Scenario: 时间范围切换
- **WHEN** admin 选择不同时间范围（1天/7天/30天）
- **THEN** 所有图表更新为对应时间范围的数据

#### Scenario: 按需加载
- **WHEN** admin 首次进入运营大盘
- **THEN** recharts 组件通过 React.lazy 按需加载，不影响其他页面加载速度
