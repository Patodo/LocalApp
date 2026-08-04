## MODIFIED Requirements

### Requirement: init 命令支持一键部署
`localapp init --name <name>` SHALL 在克隆模板后自动执行安装依赖、注册页面、构建、上传的完整流程。

#### Scenario: 已登录用户执行 init
- **WHEN** 用户已登录（config.json 中有 api_key）且执行 `localapp init --name my-app`
- **THEN** CLI 依次执行：克隆模板 → 写 manifest.json → npm install → POST /api/pages → npm run build → POST /api/upload → 打印访问 URL

#### Scenario: 未登录用户执行 init
- **WHEN** 用户未登录（config.json 中无 api_key）且执行 `localapp init --name my-app`
- **THEN** CLI 返回错误："Not configured. Run 'localapp login' first."（克隆模板需从服务端获取 templateRepoUrl，因此登录是前置条件）

#### Scenario: 使用 --skip-deploy flag
- **WHEN** 用户执行 `localapp init --name my-app --skip-deploy`
- **THEN** CLI 只执行脚手架步骤，跳过所有部署相关步骤（即使已登录）

#### Scenario: npm install 失败
- **WHEN** init 执行 npm install 时失败（退出码非 0）
- **THEN** CLI 打印错误信息并中止，提示用户可手动 cd 进目录执行 npm install

#### Scenario: 构建失败
- **WHEN** init 执行 npm run build 时失败
- **THEN** CLI 打印错误信息并中止，提示用户可修复后手动 localapp upload
