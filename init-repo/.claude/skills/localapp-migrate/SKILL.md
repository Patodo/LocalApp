---
name: localapp-migrate
description: 将已有 LocalApp 应用的原始源码上传到明确的 Server，关联已有应用并检查源码托管结果。用于旧应用迁移，不用于同步业务数据或自动上线。
---

# 旧应用源码迁移

完成迁移意味着：原始源码与二进制资源保存在目标 Server 的开发项目中，项目关联已有应用，有初始源码版本，并完成可执行的验证。迁移不会安装应用包、更新正式版本或复制业务数据。

## 确认项目与目标

- 在原始项目根目录工作，读取项目的 AGENTS.md、manifest.json 和 package.json。只有 dist 或安装包时，说明缺少原始源码，不能用模板生成的项目代替。
- 确定目标 Server 的 CLI profile，应用名称由 manifest.json 读取，用户身份由 Server 根据 API Key 识别。不能把默认 profile 当作用户指定的目标。缺少目标时先完成本地检查，再询问目标。
- 使用 `localapp whoami --profile <profile>` 验证身份；上传者必须是应用拥有者。未登录时使用 `localapp login <url> --profile <profile>` 的正常登录流程，不把密钥写进项目或命令示例。
- manifest.name 必须匹配已有应用，package.json 必须有 test 和 build 脚本。检查失败先修复必要问题，不修改业务功能来完成迁移。

## 检查并上传

以下脚本路径相对于本 Skill 目录；项目参数使用原始源码目录的绝对路径。

```bash
node <skill-directory>/scripts/migrate-source.mjs --project <project-directory>
```

默认只检查，输出文件清单、大小和排除目录，不打印文件内容或凭据。包含代码、锁文件、开发说明及图片等资源；排除依赖、构建、缓存、`.localapp`、`.git`、对话附件和常见密钥文件。遇到符号链接或超限文件时停止，不能静默丢弃资源。检查清单中的配置文件，确认没有项目自定义的密钥文件；发现时先从源码拆出，使用平台配置。

用户已要求把此项目迁移到明确的 Server 时，可以执行上传；只有讨论或检查请求时不要上传。

```bash
node <skill-directory>/scripts/migrate-source.mjs --project <project-directory> --profile <profile> --upload
```

脚本使用已保存的 CLI profile，检查登录身份和应用存在，再调用 Server 源码导入接口。上传后读取项目、文件列表和初始版本进行核对，在本地 `.localapp/source-migration.json` 保存目标、项目 ID 和源码版本，不保存凭据。

已存在服务端项目时返回 `already-hosted`，不覆盖；这不证明本地修改已经上传。上传结果不确定时先查询目标项目，最多重试一次相同迁移，不删除服务端项目来重试。401/403 交给登录或身份问题处理；409 检查已有项目；旧 Server 不支持二进制导入时更新目标 Server，不能删除图片后声称迁移成功。

## 验证与交付

1. 运行应用自己的测试与 `localapp check --json`。记录失败，不为迁移绕过检查。
2. 打开脚本返回的服务端开发页，确认源码、资源和版本存在，执行检查与构建；成功后打开预览验证核心读写。构建失败时保留已上传源码和日志，报告“源码已托管，运行验证未通过”，继续修复用户已授权的问题。
3. 从正式 `/<owner>/<app>/` 入口确认现有应用仍能运行，正式版本未因迁移改变。不要用 `/serve/` 代替验收。
4. 报告目标 Server、应用、项目 ID、源码版本、上传文件数、验证结果和开发页链接。未核对当前部署对应的源码时，不声称与线上版本一致。

发布是单独动作，仅在用户要求上线时执行。现有 `localapp app sync` 同步的是应用版本/数据，不是源码；不要把它当作未来源码 pull/push，或编造尚未提供的 CLI 命令。
