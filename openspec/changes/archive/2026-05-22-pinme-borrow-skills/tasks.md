## 1. 核心技能升级

- [x] 1.1 创建 `init-repo/.claude/skills/localapp.md`：项目识别、部署流程、CLI 命令参考、数据模式概览、访问控制、Guardrails
- [x] 1.2 验证 skill 触发：description 覆盖 localapp/部署/创建项目/manifest.json 等触发场景

## 2. 数据技能新增

- [x] 2.1 创建 `init-repo/.claude/skills/localapp-data.md`：CRUD 模式 + SQL 模式 + useExec + 模式选择指南 + 8 个 Hook 完整示例
- [x] 2.2 验证 skill 触发：description 覆盖数据存储/SQL/CRUD/数据表/Hook 等触发场景

## 3. 认证技能新增

- [x] 3.1 创建 `init-repo/.claude/skills/localapp-auth.md`：useMe/redirectToLogin/双层访问控制/四种级别/错误处理
- [x] 3.2 验证 skill 触发：description 覆盖登录/权限/认证/访问控制等触发场景

## 4. 模板 CLAUDE.md 更新

- [x] 4.1 在 `init-repo/CLAUDE.md` 末尾新增"Raw SQL 模式"章节：useExec() Hook 完整示例、db.mode 配置说明、sqlAccess 权限说明、SQL 模式 vs CRUD 模式选择指南
- [x] 4.2 验证文档完整性：确认 CLAUDE.md 覆盖所有 SDK Hook（useMe/useList/useGet/useCreate/useUpdate/useDelete/useCount/useExec）

## 5. 收尾

- [x] 5.1 提交所有变更
