## ADDED Requirements

### Requirement: platform-runtime 支持 native host
`@localapp/sdk-agent/platform-runtime` SHALL 在 native 页面中通过同页 host 请求平台能力。应用侧 API SHALL 与 dev 和 production 保持一致。

#### Scenario: 同页能力请求
- **WHEN** `window.parent === window` 且应用调用 `platform.copyText("x")`
- **THEN** SDK SHALL 向同页 platform host 发出能力请求
- **AND** SDK SHALL 等待标准响应并 resolve

#### Scenario: 不直接使用浏览器原生 confirm
- **WHEN** 应用调用 `platform.confirm(...)`
- **THEN** SDK SHALL NOT 直接调用 `window.confirm`
- **AND** SDK SHALL 通过 platform host 获取确认结果

### Requirement: 工具注册支持 native registry
`useRegisterTools` SHALL 在 native 模式下向同页 shell registry 注册工具 schema、systemHint 和 execute 映射，不再要求 iframe `window.parent.postMessage`。

#### Scenario: native 注册工具
- **WHEN** native 应用调用 `useRegisterTools({ tools, systemHint })`
- **THEN** SDK SHALL 将工具注册到同页 shell registry
- **AND** 平台 AI SHALL 能调用这些工具并收到结果

## MODIFIED Requirements

### Requirement: useRegisterTools Hook
`useRegisterTools(options?)` Hook SHALL 允许应用向 Platform Shell 注册工具定义和系统提示词。Hook SHALL 在 native 模式下使用同页 shell registry；在兼容测试环境中可以使用标准消息协议。Hook SHALL 在本地维护工具名到 execute 函数的映射，并在 Shell 调用工具时执行对应函数，将结果返回给 Shell。

#### Scenario: 注册工具到 Shell
- **WHEN** 应用调用 `useRegisterTools({ tools: { fillForm: { description, parameters, execute } }, systemHint: "请假应用" })`
- **THEN** Shell SHALL 收到 `{ name: "fillForm", description, parameters }` 和 systemHint
- **AND** 本地 SHALL 保存 `{ fillForm: execute }` 映射

#### Scenario: 执行工具调用
- **WHEN** Shell 调用 `{ callId: "c1", toolName: "fillForm", args: { field: "name" } }`
- **THEN** SDK SHALL 查找本地 `fillForm` 的 execute 函数
- **AND** SDK SHALL 执行 `execute({ field: "name" })`
- **AND** SDK SHALL 将 result 返回给 Shell

#### Scenario: 未在 Shell 中运行
- **WHEN** 应用未被 LocalApp shell 承载
- **THEN** Hook SHALL 静默跳过 shell 注册
