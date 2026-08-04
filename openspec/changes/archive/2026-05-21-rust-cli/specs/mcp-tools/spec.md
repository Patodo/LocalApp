## REMOVED Requirements

### Requirement: upload_page
**Reason**: MCP client 被替换为 Rust CLI + Skill。上传功能由 CLI `upload` 命令实现。
**Migration**: 使用 `localapp upload <path>` CLI 命令

### Requirement: create_schema
**Reason**: MCP client 被替换为 Rust CLI + Skill。Schema 管理由 CLI `schemas` 子命令实现。
**Migration**: 使用 `localapp schemas create <name> --fields <json>`

### Requirement: list_pages
**Reason**: MCP client 被替换为 Rust CLI + Skill。页面列表由 CLI `pages list` 命令实现。
**Migration**: 使用 `localapp pages list`

### Requirement: delete_page
**Reason**: MCP client 被替换为 Rust CLI + Skill。页面删除由 CLI `pages delete` 命令实现。
**Migration**: 使用 `localapp pages delete`

### Requirement: get_page_info
**Reason**: MCP client 被替换为 Rust CLI + Skill。页面详情由 CLI `pages info` 命令实现。
**Migration**: 使用 `localapp pages info`
