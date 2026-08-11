use std::path::Path;

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_root = Path::new(&manifest_dir).parent().unwrap().parent().unwrap();
    let cargo_toml_path = Path::new(&manifest_dir).join("Cargo.toml");
    let cli_version = std::env::var("CARGO_PKG_VERSION").unwrap();
    println!("cargo:rustc-env=LOCALAPP_CLI_VERSION={cli_version}");
    println!("cargo:rerun-if-changed={}", cargo_toml_path.display());

    // ── init-repo 模板的 staging 已下沉到 localapp-template crate ──
    // 此处不再复制 init-repo / SDK 源码；CLI 通过 `localapp-template` 依赖
    // 引用编译期内嵌的 BUILTIN_TEMPLATE。

    // ── SDK directories (legacy, used by template.rs extract_sdk_vendor) ──
    // These remain pointing at source dirs until template.rs is refactored
    // to read SDK from BUILTIN_TEMPLATE/runtime/sdk/ instead.
    let sdk_core_dir = std::env::var("SDK_CORE_DIR").unwrap_or_else(|_| {
        project_root
            .join("packages/sdk-core")
            .to_str()
            .unwrap()
            .to_string()
    });
    println!("cargo:rustc-env=SDK_CORE_DIR={}", sdk_core_dir);
    println!("cargo:rerun-if-env-changed=SDK_CORE_DIR");

    let sdk_react_dir = std::env::var("SDK_REACT_DIR").unwrap_or_else(|_| {
        project_root
            .join("packages/sdk-react")
            .to_str()
            .unwrap()
            .to_string()
    });
    println!("cargo:rustc-env=SDK_REACT_DIR={}", sdk_react_dir);
    println!("cargo:rerun-if-env-changed=SDK_REACT_DIR");

    let sdk_agent_dir = std::env::var("SDK_AGENT_DIR").unwrap_or_else(|_| {
        project_root
            .join("packages/sdk-agent")
            .to_str()
            .unwrap()
            .to_string()
    });
    println!("cargo:rustc-env=SDK_AGENT_DIR={}", sdk_agent_dir);
    println!("cargo:rerun-if-env-changed=SDK_AGENT_DIR");
}
