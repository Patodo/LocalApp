//! 外部 coding agent 的集成。
//!
//! 当前实现:opencode 通过 HTTP+SSE 协议(`opencode serve`)。
//! 这是标准 SDK 集成方式——支持多轮对话、流式 token、工具调用事件、abort。
//! claude/codex 等其他 agent 仍走 `spawn` 模块的一次性 stdio(兼容保留)。

pub mod opencode_server;
pub mod session;
pub mod spawn;

pub use session::{AgentSession, AgentSessionRegistry, AgentSessionStatus};
pub use spawn::{AgentCli, AgentRequest, DiscoveredAgent, PromptMode};
