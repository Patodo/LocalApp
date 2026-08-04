## ADDED Requirements

### Requirement: native 应用验收运行在正式 Shell route

LocalApp native 应用的用户体验验收 SHALL 在正式 Shell route `/{userId}/{name}` 中进行。该验收 SHALL 覆盖平台 nav-shell、平台能力 host 和 app container 的组合运行形态。`/serve/{userId}/{name}/` SHALL NOT 被用作 native 应用用户体验验收入口。

#### Scenario: 验证 native app 生产形态
- **WHEN** agent 验证已上传应用的生产形态
- **THEN** agent SHALL 打开 `/{userId}/{name}`
- **AND** 页面 SHALL 渲染平台 nav-shell
- **AND** 页面 SHALL 包含 native app mount container

#### Scenario: raw 页面不能代表生产形态
- **WHEN** agent 打开 `/serve/{userId}/{name}/`
- **THEN** 页面 MAY 返回上传应用的裸 `index.html`
- **AND** 该结果 SHALL NOT 被用于判断 native Shell、平台能力 host 或 nav-shell 是否正常
