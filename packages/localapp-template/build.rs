use std::fs;
use std::path::Path;

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let project_root = Path::new(&manifest_dir)
        .parent()
        .expect("localapp-template must live under packages/")
        .parent()
        .expect("localapp-template must live under packages/localapp-template");
    let cargo_toml_path = Path::new(&manifest_dir).join("Cargo.toml");
    let crate_version = std::env::var("CARGO_PKG_VERSION").unwrap();
    println!("cargo:rustc-env=LOCALAPP_TEMPLATE_VERSION={crate_version}");
    println!("cargo:rerun-if-changed={}", cargo_toml_path.display());

    // ── Staging: copy init-repo (用户领地 + runtime/ CLI 领地源码) ──
    let init_repo_src = project_root.join("init-repo");
    let staging_dir = Path::new(&manifest_dir).join("target/init-repo-staging");

    // Rebuild if init-repo source changes
    println!("cargo:rerun-if-changed=../../init-repo/src");
    println!("cargo:rerun-if-changed=../../init-repo/package.json");
    println!("cargo:rerun-if-changed=../../init-repo/index.html");
    println!("cargo:rerun-if-changed=../../init-repo/vite.config.ts");
    println!("cargo:rerun-if-changed=../../init-repo/tsconfig.json");
    println!("cargo:rerun-if-changed=../../init-repo/vitest.config.ts");
    println!("cargo:rerun-if-changed=../../init-repo/tailwind.config.js");
    println!("cargo:rerun-if-changed=../../init-repo/CLAUDE.md");
    println!("cargo:rerun-if-changed=../../init-repo/AGENTS.md");
    println!("cargo:rerun-if-changed=../../init-repo/.npmrc");
    println!("cargo:rerun-if-changed=../../init-repo/manifest.json");
    println!("cargo:rerun-if-changed=../../init-repo/.claude/skills");
    println!("cargo:rerun-if-changed=../../init-repo/runtime");
    println!("cargo:rerun-if-changed=../../platform/capabilities.json");

    // Rebuild if SDK source changes (gets staged into runtime/sdk/)
    println!("cargo:rerun-if-changed=../../packages/sdk-core/src");
    println!("cargo:rerun-if-changed=../../packages/sdk-core/package.json");
    println!("cargo:rerun-if-changed=../../packages/sdk-react/src");
    println!("cargo:rerun-if-changed=../../packages/sdk-react/package.json");
    println!("cargo:rerun-if-changed=../../packages/sdk-agent/src");
    println!("cargo:rerun-if-changed=../../packages/sdk-agent/package.json");
    println!("cargo:rerun-if-changed=../../packages/backend/src");
    println!("cargo:rerun-if-changed=../../packages/backend/package.json");
    println!("cargo:rerun-if-changed=../../packages/server-core/dist");
    println!("cargo:rerun-if-changed=../../packages/server-core/package.json");

    let exclude_dirs = ["node_modules", "dist", ".next", ".DS_Store"];

    // Clear staging dir and copy fresh
    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).unwrap();
    }
    copy_dir_recursive(&init_repo_src, &staging_dir, &exclude_dirs);

    // ── Staging: inject SDK into runtime/sdk/{core,react,agent,backend}/ ──
    // SDK 是 CLI 领地的一部分，与 runtime/ 一起原子抽取到用户项目。
    stage_sdk(
        project_root,
        &staging_dir,
        "sdk-core",
        "core",
        &exclude_dirs,
    );
    stage_sdk(
        project_root,
        &staging_dir,
        "sdk-react",
        "react",
        &exclude_dirs,
    );
    stage_sdk(
        project_root,
        &staging_dir,
        "sdk-agent",
        "agent",
        &exclude_dirs,
    );
    stage_sdk(
        project_root,
        &staging_dir,
        "backend",
        "backend",
        &exclude_dirs,
    );
    stage_server_core(project_root, &staging_dir, &exclude_dirs);

    // ── Staging: generate runtime/version.json ──
    // 写入 crate 版本号（由调用方按需覆盖为 CLI/Desktop 版本）。
    let version_path = staging_dir.join("runtime/version.json");
    let version_content = format!("{{\n  \"cliVersion\": \"{}\"\n}}\n", crate_version);
    fs::create_dir_all(version_path.parent().unwrap()).unwrap();
    fs::write(&version_path, version_content).unwrap();

    let staging_str = staging_dir.to_str().unwrap();
    println!("cargo:rustc-env=INIT_REPO_DIR={}", staging_str);
}

/// 将 packages/<sdk_name> 复制到 staging/runtime/sdk/<target_name>/。
///
/// SDK 包是 CLI 领地的一部分，stage 后通过 include_dir! 嵌入二进制，
/// 用户项目 init 时从 BUILTIN_TEMPLATE/runtime/sdk/ 直接抽取。
fn stage_sdk(
    project_root: &Path,
    staging_dir: &Path,
    sdk_name: &str,
    target_name: &str,
    exclude_dirs: &[&str],
) {
    let src = project_root.join("packages").join(sdk_name);
    let dst = staging_dir.join("runtime/sdk").join(target_name);
    if !src.exists() {
        panic!(
            "SDK source missing at {}: localapp monorepo layout expected",
            src.display()
        );
    }
    copy_dir_recursive(&src, &dst, exclude_dirs);
}

fn stage_server_core(project_root: &Path, staging_dir: &Path, exclude_dirs: &[&str]) {
    let src = project_root.join("packages/server-core");
    let dst = staging_dir.join("runtime/server-core");
    if !src.join("dist/index.js").exists() {
        panic!(
            "server-core dist missing at {}: run `pnpm -C packages/server-core build` before building",
            src.join("dist/index.js").display()
        );
    }
    let server_core_excludes: Vec<&str> = exclude_dirs
        .iter()
        .copied()
        .filter(|name| *name != "dist")
        .collect();
    copy_dir_recursive(&src, &dst, &server_core_excludes);
}

fn copy_dir_recursive(src: &Path, dst: &Path, exclude: &[&str]) {
    fs::create_dir_all(dst).unwrap();
    for entry in fs::read_dir(src).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name().to_string_lossy().to_string();
        if exclude.contains(&name.as_str()) {
            continue;
        }
        let src_path = entry.path();
        let dst_path = dst.join(&name);
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path, exclude);
        } else {
            fs::copy(&src_path, &dst_path).unwrap();
        }
    }
}
