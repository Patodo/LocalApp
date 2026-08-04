## ADDED Requirements

### Requirement: 远程发布固定目标且不携带本地数据

远程发布 SHALL 将已解析的单一 Server 目标贯穿检查、数据库兼容验证、页面注册、上传和部署验证。发布 bundle SHALL 只包含应用代码产物、manifest、migrations 和 backend contract，SHALL NOT 隐式包含 Local Runtime 数据库、文件、备份或平台配置。

#### Scenario: 发布到指定 Server
- **WHEN** 用户选择一个命名 Server 发布本地应用
- **THEN** 发布的全部远端阶段 SHALL 只访问该 Server
- **AND** 成功结果 SHALL 返回该 Server 上的正式应用 URL

#### Scenario: 本地数据不随发布上传
- **WHEN** 本地应用存在数据库记录、用户文件、备份和平台配置
- **THEN** 常规远程发布 SHALL NOT 上传这些本地数据
- **AND** 远端应用 SHALL 使用自身独立的数据空间
