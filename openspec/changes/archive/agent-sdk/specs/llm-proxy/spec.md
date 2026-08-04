## Purpose

服务端 LLM 代理端点。验证用户身份后转发 LLM 请求，服务端管理 API Key，向前端提供 SSE 流式响应。前端无需接触 LLM API Key。

## ADDED Requirements

### Requirement: LLM 代理端点

服务端 SHALL 提供 `POST /api/llm/chat` 端点，接收符合 OpenAI Chat Completions 格式的请求体（messages 数组），验证用户身份后转发至配置的 LLM 服务，返回 SSE 流式响应。

#### Scenario: 已登录用户发起对话
- **WHEN** 已登录用户发送 `POST /api/llm/chat` 携带 `{ messages: [{ role: "user", content: "你好" }] }`
- **THEN** 返回 200，Content-Type 为 `text/event-stream`，SSE 事件体包含 LLM 的流式响应

#### Scenario: 未登录用户发起对话
- **WHEN** 未登录用户发送 `POST /api/llm/chat`
- **THEN** 返回 401

#### Scenario: 请求体缺少 messages
- **WHEN** 已登录用户发送 `POST /api/llm/chat` 不包含 messages 字段
- **THEN** 返回 400

#### Scenario: messages 格式错误
- **WHEN** 已登录用户发送 `POST /api/llm/chat` 携带 `{ messages: "invalid" }`
- **THEN** 返回 400

#### Scenario: LLM 服务不可用
- **WHEN** 已登录用户发送 `POST /api/llm/chat` 但 LLM 服务返回错误
- **THEN** 返回 502，错误体包含上游错误信息

### Requirement: LLM 配置管理

服务端 SHALL 通过环境变量管理 LLM 配置：`LLM_API_KEY`（必填）、`LLM_MODEL`（默认 `gpt-4o-mini`）、`LLM_BASE_URL`（默认 OpenAI API 地址）。

#### Scenario: 未配置 LLM_API_KEY
- **WHEN** 服务端未设置 `LLM_API_KEY` 环境变量
- **THEN** `POST /api/llm/chat` 返回 503，提示服务未配置

#### Scenario: 使用默认模型
- **WHEN** 未设置 `LLM_MODEL` 环境变量
- **THEN** 使用 `gpt-4o-mini` 作为默认模型

### Requirement: SSE 流式响应格式

LLM 代理端点 SHALL 将 LLM 响应以 SSE 格式返回。每个 SSE 事件的 data 字段包含符合 OpenAI Chat Completions chunk 格式的 JSON，流结束时发送 `data: [DONE]`。

#### Scenario: 流式响应正常完成
- **WHEN** LLM 返回流式响应
- **THEN** 每个 chunk 作为独立的 SSE 事件发送，最后发送 `data: [DONE]`

#### Scenario: 流式响应中断
- **WHEN** LLM 流式响应中途出错
- **THEN** 发送包含错误信息的 SSE 事件，然后发送 `data: [DONE]`
