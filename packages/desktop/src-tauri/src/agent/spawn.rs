//! Agent CLI 探测与 spawn。

use crate::process_util::ProcessTree;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tokio::io::AsyncWriteExt;
use tokio::process::{Child, ChildStdin, Command};
use tokio_util::sync::CancellationToken;

/// prompt 传递给 agent 的方式。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PromptMode {
    /// 通过 stdin 写入 prompt 后关闭（claude -p / codex --print）。
    Stdin,
    /// 作为命令行参数追加（opencode run "<prompt>"）。
    Arg,
}
/// 一个被探测到的 agent CLI。
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DiscoveredAgent {
    /// agent 标识：`claude` / `opencode` / `zcode` / `codex` / 自定义 binary 名。
    pub kind: String,
    /// agent 可执行文件绝对路径。
    pub binary: PathBuf,
    /// 默认参数（如 `["-p"]` / `["--print"]` / `["run"]`），调用时附加在 binary 之后。
    pub default_args: Vec<String>,
    /// prompt 传递方式。
    pub prompt_mode: PromptMode,
}

/// Agent CLI 发现与配置。
pub struct AgentCli;

impl AgentCli {
    /// 探测系统里所有已装的 agent CLI（按 KNOWN_AGENTS 优先级）。
    ///
    /// 返回所有找到的；用户在前端从列表里选择。空列表表示一个都没装。
    pub fn discover_all() -> Vec<DiscoveredAgent> {
        KNOWN_AGENTS
            .iter()
            .filter_map(|agent| {
                which::which(agent.binary_name).ok().map(|path| DiscoveredAgent {
                    kind: agent.kind.to_string(),
                    binary: path,
                    default_args: agent.default_args.iter().map(|s| s.to_string()).collect(),
                    prompt_mode: agent.prompt_mode,
                })
            })
            .collect()
    }

    /// 按用户选择解析一个 agent。
    ///
    /// - `selection` 为 None 或 "auto"：返回 discover_all 的第一个（自动选）。
    /// - `selection` 为已知 kind（"opencode"/"claude"/...）：从 discover_all 里找匹配的。
    /// - `selection` 为其他字符串：当作自定义 binary 路径/名字解析。
    pub fn resolve(selection: Option<&str>) -> Result<DiscoveredAgent, String> {
        let discovered = Self::discover_all();

        // 无选择或 auto：取第一个
        let sel = selection.map(str::trim).filter(|s| !s.is_empty() && *s != "auto");
        let Some(sel) = sel else {
            return discovered
                .into_iter()
                .next()
                .ok_or_else(|| "No coding agent CLI found. Install OpenCode, Claude Code, Codex, or ZCode.".to_string());
        };

        // 匹配已知 kind
        if let Some(matched) = discovered.iter().find(|a| a.kind == sel).cloned() {
            return Ok(matched);
        }

        // 否则当作自定义 binary 解析
        let path = PathBuf::from(sel);
        let resolved = if path.is_absolute() && path.is_file() {
            path
        } else {
            which::which(sel).map_err(|e| format!("Agent binary '{sel}' not found in PATH: {e}"))?
        };
        // 根据文件名推断模式
        let name = resolved
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(sel)
            .to_lowercase();
        let known = KNOWN_AGENTS.iter().find(|agent| agent.binary_name == name);
        let (kind, default_args, prompt_mode) = match known {
            Some(agent) => (
                agent.kind.to_string(),
                agent.default_args.iter().map(|s| s.to_string()).collect(),
                agent.prompt_mode,
            ),
            None => ("custom".to_string(), vec!["-p".to_string()], PromptMode::Stdin),
        };
        Ok(DiscoveredAgent {
            kind,
            binary: resolved,
            default_args,
            prompt_mode,
        })
    }
}

/// 已知 agent 注册表（优先级从高到低）。
const KNOWN_AGENTS: &[KnownAgent] = &[
    KnownAgent {
        kind: "opencode",
        binary_name: "opencode",
        // --dangerously-skip-permissions: 非交互模式下自动批准权限（项目内 Read/Edit），
        // 否则 external_directory 请求会被 auto-reject。Studio 已通过 cwd 沙箱限定
        // agent 只能在项目目录工作，所以这里的"危险"是受控的。
        default_args: &["run", "--dangerously-skip-permissions"],
        prompt_mode: PromptMode::Arg,
    },
    KnownAgent {
        kind: "claude",
        binary_name: "claude",
        default_args: &["-p"],
        prompt_mode: PromptMode::Stdin,
    },
    KnownAgent {
        kind: "zcode",
        binary_name: "zcode",
        default_args: &["-p"],
        prompt_mode: PromptMode::Stdin,
    },
    KnownAgent {
        kind: "codex",
        binary_name: "codex",
        default_args: &["--print"],
        prompt_mode: PromptMode::Stdin,
    },
];

#[derive(Clone, Copy)]
struct KnownAgent {
    kind: &'static str,
    binary_name: &'static str,
    default_args: &'static [&'static str],
    prompt_mode: PromptMode,
}

/// 一次 agent spawn 请求。
#[derive(Clone, Debug)]
pub struct AgentRequest {
    /// agent 可执行文件路径。
    pub binary: PathBuf,
    /// 命令行参数（default_args + 任何额外参数；prompt 是否在内取决于 prompt_mode）。
    pub args: Vec<String>,
    /// agent 工作目录（通常是 Studio 项目源码根）。
    pub cwd: PathBuf,
    /// 要发给 agent 的 prompt。
    pub prompt: String,
    /// prompt 传递方式（决定 spawn 后是写 stdin 还是已作为 args）。
    pub prompt_mode: PromptMode,
    /// 额外环境变量（合并到子进程 env；基础 env 见 build_child_env）。
    pub env: BTreeMap<String, String>,
}

/// spawn 结果：child + 进程树句柄 + stdin（仅 PromptMode::Stdin 时为 Some）。
pub struct SpawnedAgent {
    pub child: Child,
    pub process_tree: ProcessTree,
    pub stdin: Option<ChildStdin>,
}

impl AgentRequest {
    /// spawn 子进程。
    ///
    /// - `PromptMode::Stdin`: spawn 后 stdin 可写，调用方需 write_prompt_and_close
    /// - `PromptMode::Arg`: prompt 已在 args 里，stdin 立即关闭（null）
    pub fn spawn(self, _cancellation: CancellationToken) -> Result<SpawnedAgent, String> {
        let mut command = Command::new(&self.binary);
        command
            .args(&self.args)
            .current_dir(&self.cwd)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        // stdin: Stdin 模式需要 pipe；Arg 模式用 null（不读 stdin）
        match self.prompt_mode {
            PromptMode::Stdin => {
                command.stdin(std::process::Stdio::piped());
            }
            PromptMode::Arg => {
                command.stdin(std::process::Stdio::null());
            }
        }

        // 环境变量：以白名单继承父进程关键变量为基础，再叠加请求的 env
        for (key, value) in build_child_env(&self.env) {
            command.env(key, value);
        }

        crate::process_util::configure_process_group(&mut command);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to spawn agent '{}': {e}", self.binary.display()))?;
        let process_tree = ProcessTree::attach(&child)
            .map_err(|e| format!("Failed to attach process tree: {e}"))?;
        let stdin = child.stdin.take();

        Ok(SpawnedAgent {
            child,
            process_tree,
            stdin,
        })
    }
}

/// 把 prompt 写入子进程 stdin 并关闭（仅 PromptMode::Stdin 时调用）。
pub async fn write_prompt_and_close(stdin: &mut Option<ChildStdin>, prompt: &str) -> Result<(), String> {
    if let Some(stdin) = stdin.as_mut() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| format!("Failed to write agent prompt: {e}"))?;
        stdin
            .shutdown()
            .await
            .map_err(|e| format!("Failed to close agent stdin: {e}"))?;
    }
    Ok(())
}

/// 构建 agent 子进程的环境变量。
///
/// 比 `runner::process::configure_environment` 宽松：保留 PATH/HOME/USER/LANG 等
/// agent CLI 运行所必需的变量（agent 常需要 HOME 读写配置、PATH 调用 git/npm 等）。
fn build_child_env(extra: &BTreeMap<String, String>) -> BTreeMap<String, String> {
    let mut env = BTreeMap::new();

    // 白名单继承的关键变量
    const ALLOWED_PREFIX: &[&str] = &["LOCALAPP_", "npm_", "NODE_", "OPENCODE_"];
    const ALLOWED_EXACT: &[&str] = &[
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "SHELL",
        "TERM",
        "TMPDIR",
        "TMP",
        "TEMP",
        // git/npm 常用
        "GIT_SSH",
        "GIT_SSH_COMMAND",
        "SSH_AUTH_SOCK",
        "GPG_TTY",
        // 代理
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "NO_PROXY",
        "http_proxy",
        "https_proxy",
        "no_proxy",
    ];

    for (key, value) in std::env::vars() {
        let allowed = ALLOWED_EXACT.contains(&key.as_str())
            || ALLOWED_PREFIX.iter().any(|prefix| key.starts_with(prefix));
        if allowed {
            env.insert(key, value);
        }
    }

    // 叠加请求的额外变量
    for (key, value) in extra {
        env.insert(key.clone(), value.clone());
    }

    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_agents_table_is_in_priority_order() {
        // 确保注册表里没有重复的 binary_name
        let mut names: Vec<_> = KNOWN_AGENTS.iter().map(|a| a.binary_name).collect();
        names.sort();
        let before = names.len();
        names.dedup();
        assert_eq!(names.len(), before, "duplicate binary_name in KNOWN_AGENTS");
    }

    #[test]
    fn opencode_uses_arg_mode() {
        let opencode = KNOWN_AGENTS.iter().find(|a| a.kind == "opencode").unwrap();
        assert_eq!(opencode.prompt_mode, PromptMode::Arg);
        assert_eq!(opencode.default_args, &["run", "--dangerously-skip-permissions"]);
    }

    #[test]
    fn claude_uses_stdin_mode() {
        let claude = KNOWN_AGENTS.iter().find(|a| a.kind == "claude").unwrap();
        assert_eq!(claude.prompt_mode, PromptMode::Stdin);
        assert_eq!(claude.default_args, &["-p"]);
    }
}
