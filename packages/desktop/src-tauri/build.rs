fn main() {
    // Tauri validates resource paths before the package scripts can populate
    // them during a direct `cargo test`/`cargo build` invocation.
    std::fs::create_dir_all("resources/server").expect("create Server resource directory");
    std::fs::create_dir_all("resources/node").expect("create Node resource directory");
    tauri_build::build()
}
