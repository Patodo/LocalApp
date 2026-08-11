mod client;
mod commands;
mod config;
mod platform_capabilities;
mod pm;
mod project;
mod scripts;
mod template;
mod version;

use clap::{CommandFactory, Parser, Subcommand};

const SCHEMAS_DEPRECATED_MESSAGE: &str = "localapp schemas is deprecated and no longer writes platform schemas. Use 'localapp generate schema <name>' to scaffold backend/resources/<name>/, then edit backend contract files.";

#[derive(Parser)]
#[command(
    name = "localapp",
    version = version::cli_version(),
    about = "LocalApp — 本地优先的应用创建、运行与发布工具"
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand)]
enum Commands {
    /// 查看 CLI 命令帮助（`localapp <command>` 即可执行，无需此前缀）
    Cli,
    /// 创建新项目（含模板下载、依赖安装、首次部署）
    Init {
        /// 项目名称（小写字母、数字、连字符，3-63 个字符）
        #[arg(long)]
        name: String,
        /// 项目描述
        #[arg(long)]
        description: Option<String>,
        /// 跳过部署步骤（注册、构建、上传），不要求登录。仍会安装依赖
        #[arg(long)]
        skip_deploy: bool,
        /// 跳过 npm install（用于离线或手动安装场景）
        #[arg(long)]
        skip_install: bool,
        /// 使用内置模板，不从服务端拉取
        #[arg(long, alias = "builtin_repo")]
        builtin_repo: bool,
    },
    /// 验证并保存 LocalApp Server 地址和 API 密钥
    Login {
        /// 服务器地址（非交互式）
        #[arg(long)]
        server_url: Option<String>,
        /// API 密钥（非交互式）
        #[arg(long)]
        api_key: Option<String>,
        /// 保存到指定 Server profile
        #[arg(long)]
        profile: Option<String>,
    },
    /// 在本地检查并构建应用
    Build {
        /// 生成可安装的 .localapp 应用包
        #[arg(long)]
        package: bool,
        /// 应用包输出路径
        #[arg(long)]
        output: Option<String>,
    },
    /// 管理命名 LocalApp Server
    Server {
        #[command(subcommand)]
        action: ServerAction,
    },
    /// 安装应用包或在对等 Server 之间同步应用
    App {
        #[command(subcommand)]
        action: AppAction,
    },
    /// 创建新页面并关联到当前项目
    New,
    /// 在应用包构建或安装前检查平台能力、数据库、backend、测试、构建和 dist
    Check {
        /// 只向 stdout 输出一个机器可读 JSON 报告
        #[arg(long)]
        json: bool,
        /// 使用指定 Server profile 检查
        #[arg(long)]
        profile: Option<String>,
    },
    /// 在正式应用路径创建隔离身份并执行验收 smoke test
    Verify {
        /// 验证身份：owner 或 member
        #[arg(long = "as", value_parser = ["owner", "member"], default_value = "owner")]
        as_identity: String,
        /// 只向 stdout 输出一个机器可读 JSON 报告
        #[arg(long)]
        json: bool,
        /// 验证指定 Server profile 上的应用
        #[arg(long)]
        profile: Option<String>,
    },
    /// 管理页面
    Pages {
        #[command(subcommand)]
        action: PagesAction,
    },
    /// 管理数据表结构
    /// 管理用户组
    Groups {
        #[command(subcommand)]
        action: GroupsAction,
    },
    /// 查询平台版本和兼容状态
    Platform {
        #[command(subcommand)]
        action: PlatformAction,
    },
    /// 管理本地开发数据库
    Db {
        #[command(subcommand)]
        action: DbAction,
    },
    /// 管理 backend contract（resources/{queries,mutations}.json 等）
    Backend {
        #[command(subcommand)]
        action: BackendAction,
    },
    /// 启动本地开发服务器（自动配置 API 代理）
    Dev,
    /// 生成代码脚手架
    Generate {
        #[command(subcommand)]
        action: GenerateAction,
    },
    /// Convert legacy manifest.schemas into SQL migrations
    MigrateFromManifest,
    /// Deprecated: use backend contract files instead
    Schemas {
        #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
        args: Vec<String>,
    },
    /// 显示当前登录用户信息
    Whoami,
    /// 清除本地 API Key（保留服务器地址）
    Logout,
    /// 更新 CLI 到最新版本
    Update,
    /// 刷新 CLI 领地到当前 CLI 版本（.localapp/runtime/ 和 .claude/skills/localapp*/）
    Sync(commands::sync::SyncCommand),
    /// 一次性脱钩：将 CLI 领地移出管辖、转为用户代码（不可逆，失去自动更新）
    Eject(commands::eject::EjectCommand),
    /// 管理员操作（需要管理员权限）
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
}

#[derive(Subcommand)]
enum GenerateAction {
    /// 生成 Schema 定义 JSON 模板
    Schema {
        /// Schema 名称
        name: String,
    },
    /// 生成新页面 .tsx 骨架
    Page {
        /// 页面名称
        name: String,
    },
    /// 生成 React 组件骨架
    Component {
        /// 组件名称
        name: String,
    },
}

#[derive(Subcommand)]
enum AppAction {
    /// 将当前项目构建并安装到目标 Server，或安装显式指定的 .localapp 包
    Install {
        /// 目标 Server profile；省略时使用项目默认或当前 Server
        #[arg(long)]
        target: Option<String>,
        /// 显式 .localapp 包路径；省略时从当前项目构建
        #[arg(long)]
        package: Option<String>,
    },
    /// 从当前 Server 将应用版本同步到已配置的对等 Server
    Sync {
        /// 对等 Server 名称（凭据只保存在当前 Server）
        #[arg(long)]
        peer: String,
        /// 源 Server profile；省略时使用项目默认或当前 Server
        #[arg(long)]
        target: Option<String>,
        /// 同步应用数据库和上传文件；需要精确确认应用名称
        #[arg(long)]
        with_data: bool,
        /// --with-data 时必须与 manifest.json 中的应用名完全一致
        #[arg(long)]
        confirm_app: Option<String>,
    },
}

#[derive(Subcommand)]
enum ServerAction {
    /// 添加或更新命名 Server
    Add {
        /// Profile 名称
        name: String,
        /// LocalApp Server 地址
        #[arg(long)]
        server_url: String,
        /// API 密钥
        #[arg(long)]
        api_key: String,
    },
    /// 列出命名 Server
    List,
    /// 选择当前默认 Server
    Use {
        /// Profile 名称
        name: String,
    },
    /// 删除命名 Server
    Remove {
        /// Profile 名称
        name: String,
    },
}

#[derive(Subcommand)]
enum AdminAction {
    /// 查看所有用户
    Users,
    /// 查看所有页面
    Pages,
    /// 查看系统统计信息
    Stats,
}

#[derive(Subcommand)]
enum PagesAction {
    /// 列出所有页面
    List,
    /// 查看页面详情
    Info {
        /// 页面名称（默认读取项目配置）
        page_name: Option<String>,
    },
    /// 删除页面
    Delete {
        /// 页面名称（默认读取项目配置）
        page_name: Option<String>,
    },
}

#[derive(Subcommand)]
enum GroupsAction {
    /// 列出所有用户组
    List,
    /// 创建用户组
    Create {
        /// 组名称
        name: String,
        /// 组描述
        #[arg(long)]
        description: Option<String>,
    },
    /// 删除用户组
    Delete {
        /// 组名称
        name: String,
    },
    /// 查看组成员
    Members {
        /// 组名称
        group: String,
        /// 添加成员（用户 ID 列表）
        #[arg(long)]
        add: Vec<String>,
        /// 移除成员（用户 ID 列表）
        #[arg(long)]
        remove: Vec<String>,
    },
}

#[derive(Subcommand)]
enum PlatformAction {
    /// 查看 server 平台版本和 manifest platformVersion 兼容状态
    Version,
}

#[derive(Subcommand)]
enum DbAction {
    /// 从项目 tmp/ 下的离线 schema 工作库生成 TypeScript 类型
    Types {
        /// 输出文件路径
        #[arg(short, long)]
        output: String,
    },
    /// 重建离线 schema 工作库并应用 migrations 和可选 dev seed；不修改 Server 数据
    Reset,
    /// Apply pending migrations to the offline schema workbench
    Migrate,
    /// 拉取生产快照并验证本地 migrations
    Validate,
    Shell {
        #[arg(long)]
        snapshot: bool,
        #[arg(long)]
        command: Option<String>,
    },
    /// 显示离线 schema 工作库的 migration 状态
    Status,
    /// 从 server backup 恢复 app.db
    Restore {
        /// backup 名称，例如 v1
        #[arg(long)]
        backup: String,
        #[arg(long)]
        i_know_this_loses_data: bool,
        #[arg(long)]
        confirm_project_name: Option<String>,
    },
}

#[derive(Subcommand)]
enum BackendAction {
    /// 从 migrations 生成标准 named SQL CRUD 契约
    /// （$<table>.list/get/count + create/update/delete）
    Scaffold {
        /// 仅生成指定表的契约；省略则处理所有用户表
        #[arg(long)]
        table: Option<String>,
        /// 覆盖已存在的 backend/resources/<table>/ 声明
        #[arg(long)]
        force: bool,
        /// backend 根目录（默认 backend/）
        #[arg(long, default_value = "backend")]
        backend_root: String,
        /// 安全模板：public/authenticated/owner/member/parent-owner
        #[arg(long, default_value = "authenticated")]
        security_profile: String,
        /// owner/member 使用的身份字段
        #[arg(long)]
        identity_field: Option<String>,
        /// parent-owner 使用的父资源表
        #[arg(long)]
        parent_resource: Option<String>,
        /// parent-owner 使用的子表外键
        #[arg(long)]
        foreign_key: Option<String>,
        /// parent-owner 使用的父表 owner 字段（默认 created_by）
        #[arg(long)]
        parent_identity_field: Option<String>,
        /// 状态流转 name:status_field:from:to，可重复
        #[arg(long)]
        transition: Vec<String>,
    },
}

#[tokio::main]
async fn main() {
    let cli = Cli::parse();

    // 无子命令或显式 `cli`：打印 CLI 帮助。Server 本身由 Node 包或可选原生桥启动。
    match cli.command {
        None => {
            let _ = Cli::command().print_help();
            return;
        }
        Some(Commands::Cli) => {
            let _ = Cli::command().print_help();
            return;
        }
        _ => {}
    }

    // 到达此处的都是已有 CLI 子命令，前面已排除 None/Cli。
    let command = cli.command.expect("command resolved above");
    let result = match command {
        Commands::Init {
            name,
            description,
            skip_deploy,
            skip_install,
            builtin_repo,
        } => {
            commands::init::run(&name, &description, skip_deploy, skip_install, builtin_repo).await
        }
        Commands::Login {
            server_url,
            api_key,
            profile,
        } => commands::login::run(server_url, api_key, profile).await,
        Commands::Build { package, output } => {
            commands::build::run(package, output.as_deref()).await
        }
        Commands::Server { action } => match action {
            ServerAction::Add {
                name,
                server_url,
                api_key,
            } => commands::server::add(&name, &server_url, &api_key),
            ServerAction::List => commands::server::list(),
            ServerAction::Use { name } => commands::server::use_profile(&name),
            ServerAction::Remove { name } => commands::server::remove(&name),
        },
        Commands::App { action } => match action {
            AppAction::Install { target, package } => {
                commands::app::install(target.as_deref(), package.as_deref()).await
            }
            AppAction::Sync {
                peer,
                target,
                with_data,
                confirm_app,
            } => {
                commands::app::sync(&peer, target.as_deref(), with_data, confirm_app.as_deref())
                    .await
            }
        },
        Commands::New => commands::new_page::run().await,
        Commands::Check { json, profile } => commands::check::run(json, profile.as_deref()).await,
        Commands::Verify {
            as_identity,
            json,
            profile,
        } => commands::verify::run(&as_identity, json, profile.as_deref()).await,
        Commands::Pages { action } => match action {
            PagesAction::List => commands::pages::list().await,
            PagesAction::Info { page_name } => commands::pages::info(page_name).await,
            PagesAction::Delete { page_name } => commands::pages::delete(page_name).await,
        },
        Commands::Dev => commands::dev::run().await,
        Commands::Generate { action } => match action {
            GenerateAction::Schema { name } => commands::generate::run_schema(&name),
            GenerateAction::Page { name } => commands::generate::run_page(&name),
            GenerateAction::Component { name } => commands::generate::run_component(&name),
        },
        Commands::MigrateFromManifest => commands::migrate_from_manifest::run(),
        Commands::Schemas { args: _ } => Err(SCHEMAS_DEPRECATED_MESSAGE.to_string()),
        Commands::Whoami => commands::whoami::whoami().await,
        Commands::Logout => commands::whoami::logout().await,
        Commands::Update => commands::update::run().await,
        Commands::Sync(cmd) => commands::sync::run(cmd).await,
        Commands::Eject(cmd) => commands::eject::run(cmd).await,
        Commands::Groups { action } => match action {
            GroupsAction::List => commands::groups::list().await,
            GroupsAction::Create { name, description } => {
                commands::groups::create(&name, description.as_deref()).await
            }
            GroupsAction::Delete { name } => commands::groups::delete(&name).await,
            GroupsAction::Members { group, add, remove } => {
                if !add.is_empty() {
                    commands::groups::members_add(&group, &add).await
                } else if !remove.is_empty() {
                    commands::groups::members_remove(&group, &remove).await
                } else {
                    commands::groups::members(&group).await
                }
            }
        },
        Commands::Platform { action } => match action {
            PlatformAction::Version => commands::platform::version().await,
        },
        Commands::Db { action } => match action {
            DbAction::Types { output } => commands::db::types(&output),
            DbAction::Reset => commands::db::reset(),
            DbAction::Migrate => commands::db::migrate(),
            DbAction::Validate => commands::db::validate().await,
            DbAction::Shell { snapshot, command } => {
                commands::db::shell(snapshot, command.as_deref())
            }
            DbAction::Status => commands::db::status(),
            DbAction::Restore {
                backup,
                i_know_this_loses_data,
                confirm_project_name,
            } => {
                commands::db::restore(
                    &backup,
                    i_know_this_loses_data,
                    confirm_project_name.as_deref(),
                )
                .await
            }
        },
        Commands::Admin { action } => match action {
            AdminAction::Users => commands::admin::users().await,
            AdminAction::Pages => commands::admin::pages().await,
            AdminAction::Stats => commands::admin::stats().await,
        },
        Commands::Backend { action } => match action {
            BackendAction::Scaffold {
                table,
                force,
                backend_root,
                security_profile,
                identity_field,
                parent_resource,
                foreign_key,
                parent_identity_field,
                transition,
            } => match commands::backend::scaffold(commands::backend::ScaffoldOptions {
                table,
                force,
                backend_root: std::path::PathBuf::from(backend_root),
                security_profile,
                identity_field,
                parent_resource,
                foreign_key,
                parent_identity_field,
                transitions: transition,
            }) {
                Ok(summary) => {
                    if summary.generated.is_empty() && summary.skipped.is_empty() {
                        println!("No user tables found. Run localapp db migrate first.");
                    } else {
                        if !summary.generated.is_empty() {
                            println!(
                                "Generated backend/resources/{{schema,queries,mutations}}.json for {} table(s):",
                                summary.generated.len()
                            );
                            for name in &summary.generated {
                                println!("  ✓ {name}");
                            }
                        }
                        if !summary.skipped.is_empty() {
                            println!(
                                "\nSkipped {} table(s) with existing declarations (use --force to overwrite):",
                                summary.skipped.len()
                            );
                            for name in &summary.skipped {
                                println!("  → {name}");
                            }
                        }
                        println!("\nNext steps:");
                        println!(
                            "  1. Set `access` on each query/mutation (authenticated / owner / ...)"
                        );
                        println!("  2. Refine SQL for business-specific filters and WHERE guards");
                        println!("  3. Add `$<resource>.<action>` mutations for state transitions");
                    }
                    Ok(())
                }
                Err(e) => Err(e),
            },
        },
        // 前置 match 已处理并 return，逻辑上不会到达。
        Commands::Cli => unreachable!("cli handled before dispatch"),
    };

    if let Err(e) = result {
        match serde_json::from_str::<serde_json::Value>(&e) {
            Ok(value) if value.is_object() => eprintln!("{value}"),
            _ => eprintln!("{}", serde_json::json!({ "error": e })),
        }
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::{Cli, Commands, SCHEMAS_DEPRECATED_MESSAGE};
    use clap::Parser;

    #[test]
    fn schemas_command_is_parsed_only_for_deprecation_message() {
        let cli = Cli::parse_from([
            "localapp",
            "schemas",
            "create",
            "tasks",
            "--file",
            "schema.json",
        ]);
        match cli.command {
            Some(Commands::Schemas { args }) => {
                assert_eq!(args, vec!["create", "tasks", "--file", "schema.json"]);
            }
            _ => panic!("schemas command should parse as deprecated compatibility command"),
        }
        assert!(SCHEMAS_DEPRECATED_MESSAGE.contains("deprecated"));
        assert!(SCHEMAS_DEPRECATED_MESSAGE.contains("generate schema"));
    }

    #[test]
    fn check_json_command_is_non_interactive_and_parseable() {
        let cli = Cli::parse_from(["localapp", "check", "--json"]);
        match cli.command {
            Some(Commands::Check { json, .. }) => assert!(json),
            _ => panic!("check command should parse"),
        }
    }

    #[test]
    fn verify_command_requires_a_supported_identity_and_accepts_json_mode() {
        let cli = Cli::try_parse_from(["localapp", "verify", "--as", "member", "--json"])
            .expect("verify command should parse");
        match cli.command {
            Some(Commands::Verify {
                as_identity, json, ..
            }) => {
                assert_eq!(as_identity, "member");
                assert!(json);
            }
            _ => panic!("verify command should parse"),
        }
        assert!(Cli::try_parse_from(["localapp", "verify", "--as", "admin"]).is_err());
    }

    #[test]
    fn local_first_commands_and_server_profiles_are_parseable() {
        let build = Cli::try_parse_from([
            "localapp",
            "build",
            "--package",
            "--output",
            "dist/app.localapp",
        ])
        .expect("build --package should parse");
        match build.command {
            Some(Commands::Build { package, output }) => {
                assert!(package);
                assert_eq!(output.as_deref(), Some("dist/app.localapp"));
            }
            _ => panic!("build command should parse"),
        }

        let install = Cli::try_parse_from([
            "localapp",
            "app",
            "install",
            "--target",
            "staging",
            "--package",
            "app.localapp",
        ])
        .expect("app install should parse");
        assert!(matches!(install.command, Some(Commands::App { .. })));

        for arguments in [
            vec![
                "localapp",
                "server",
                "add",
                "staging",
                "--server-url",
                "https://staging.example",
                "--api-key",
                "secret",
            ],
            vec!["localapp", "server", "list"],
            vec!["localapp", "server", "use", "staging"],
            vec!["localapp", "server", "remove", "staging"],
        ] {
            Cli::try_parse_from(arguments).expect("server profile command should parse");
        }
    }

    #[test]
    fn remote_commands_accept_an_explicit_profile() {
        let check = Cli::try_parse_from(["localapp", "check", "--profile", "staging"])
            .expect("check --profile should parse");
        assert!(matches!(
            check.command,
            Some(Commands::Check {
                profile: Some(profile),
                ..
            }) if profile == "staging"
        ));

        let verify = Cli::try_parse_from(["localapp", "verify", "--profile", "staging"])
            .expect("verify --profile should parse");
        assert!(matches!(
            verify.command,
            Some(Commands::Verify {
                profile: Some(profile),
                ..
            }) if profile == "staging"
        ));
    }

    #[test]
    fn bare_command_parses_as_none_and_cli_help_exists() {
        // `localapp` 无子命令 → None，由 main 打印 CLI 帮助。
        let bare = Cli::parse_from(["localapp"]);
        assert!(bare.command.is_none());

        // `localapp cli` 进入命令帮助。
        let cli_help = Cli::parse_from(["localapp", "cli"]);
        assert!(matches!(cli_help.command, Some(Commands::Cli)));
    }

    #[test]
    fn parses_unified_app_commands_and_rejects_removed_commands() {
        assert!(Cli::try_parse_from(["localapp", "app", "install", "--target", "local",]).is_ok());
        assert!(
            Cli::try_parse_from([
                "localapp",
                "app",
                "sync",
                "--peer",
                "office",
                "--with-data",
                "--confirm-app",
                "notes",
            ])
            .is_ok()
        );
        assert!(Cli::try_parse_from(["localapp", "local", "install", "x.localapp"]).is_err());
        assert!(Cli::try_parse_from(["localapp", "upload"]).is_err());
    }
}
