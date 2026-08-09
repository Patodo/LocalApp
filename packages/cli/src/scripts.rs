//! 脚本工具。
//!
//! 实现已下沉到 `localapp-template` crate，本模块仅做 re-export，
//! 保持 CLI 内部 `use crate::scripts::script_invokes_localapp_dev` 调用点不变。

pub use localapp_template::script_invokes_localapp_dev;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_plain_localapp_dev() {
        assert!(script_invokes_localapp_dev("localapp dev"));
    }

    #[test]
    fn detects_localapp_dev_with_arguments() {
        assert!(script_invokes_localapp_dev("localapp dev --host 0.0.0.0"));
    }

    #[test]
    fn detects_localapp_dev_after_env_wrapper() {
        assert!(script_invokes_localapp_dev(
            "cross-env NODE_ENV=development localapp dev",
        ));
    }

    #[test]
    fn detects_windows_localapp_command() {
        assert!(script_invokes_localapp_dev("localapp.cmd dev"));
    }

    #[test]
    fn ignores_quoted_text() {
        assert!(!script_invokes_localapp_dev("echo \"localapp dev\""));
    }

    #[test]
    fn ignores_unrelated_dev_scripts() {
        assert!(!script_invokes_localapp_dev("vite --host 127.0.0.1"));
    }
}
