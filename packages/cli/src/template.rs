//! 模板抽取 API。
//!
//! 实现已下沉到 `localapp-template` crate，本模块仅做 re-export，
//! 保持 CLI 内部 `use crate::template::{...}` 调用点不变。

pub use localapp_template::{
    BUILTIN_TEMPLATE, clean_runtime_sdk_workspace_refs, extract_backend_seed_if_missing,
    extract_cli_zone, extract_user_zone, postprocess_package_json,
    remove_runtime_compatibility_path,
};

use crate::version::cli_version;

/// 写入 `.localapp/runtime/version.json`，内容为 `{"cliVersion": "<cli_version>"}`。
///
/// 调用 localapp-template 的参数化版本，注入当前 CLI 版本号。
pub fn write_runtime_version(target_dir: &std::path::Path) -> Result<(), String> {
    localapp_template::write_runtime_version(target_dir, cli_version())
}
