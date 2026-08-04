## MODIFIED Requirements

### Requirement: CLI init 命令输出变更
init 命令的输出 SHALL 显示完整流程的进度信息。

#### Scenario: 进度输出
- **WHEN** init 执行完整流程
- **THEN** 每个步骤通过 stderr 输出进度信息："  ✓ Cloning template..."、"  ✓ Installing dependencies..."、"  ✓ Registering page..."、"  ✓ Building project..."、"  ✓ Uploading..."、"  ✓ Deployed!"

#### Scenario: 最终输出包含访问 URL
- **WHEN** init 完整流程执行成功
- **THEN** 通过 stdout 输出 JSON `{"created":"<name>","url":"<url>"}`，URL 从服务端 upload 响应的 `data.url` 字段获取
