## Context

当前 `crud-db.ts` 的 `insertRow` 函数在构建 INSERT 语句时，遍历 schema 字段的逻辑如下（第 308-317 行）：

```ts
for (const [name, field] of Object.entries(fields)) {
    if (field.type === "auto_increment") continue;
    if (name in data) {
      columns.push(name);
      values.push(data[name] as SqlValue);
    } else if (field.type === "timestamp") {
      columns.push(name);
      values.push(now);
    }
  }
```

当字段不在输入 `data` 中时，仅处理 `timestamp` 类型（填入当前时间），忽略了 `defaultValue` 约束。同样，`alterTableAddColumn` 添加新字段时，存量行的新字段值为 `NULL`，未应用 `defaultValue`。

## Goals / Non-Goals

**Goals:**
- `insertRow` 在字段不在输入数据中且有 `defaultValue` 时，使用默认值
- `alterTableAddColumn` 在添加带 `defaultValue` 的字段时，将存量行的该字段设为默认值
- 不改变现有 API 签名和返回值格式

**Non-Goals:**
- 不处理 `updateRow` 中的默认值（更新操作不应覆盖现有值为默认值）
- 不在 SQLite schema 层面添加 `DEFAULT` 约束（sql.js 对 DDL 的 DEFAULT 支持有限）
- 不修改 `DataSchema` 类型定义

## Decisions

### Decision 1: 在应用层而非 SQL DDL 层施加默认值

在 `insertRow` 的字段遍历中增加 `else if` 分支检查 `defaultValue`，而非在 `createTable` 时通过 SQL `DEFAULT` 子句施加。

**理由**：sql.js 编译选项可能不支持完整的 SQLite DEFAULT 语法，且应用层处理保持了一致性——所有字段值逻辑（timestamp、defaultValue）都在同一处可见。

**备选方案**：在 `createTable` 的 DDL 中加入 `DEFAULT` → 放弃。sql.js 默认编译不支持部分 DEFAULT 表达式，且 ALTER TABLE ADD COLUMN 时的 DEFAULT 行为在不同 SQLite 版本中不一致。

### Decision 2: `alterTableAddColumn` 使用 UPDATE 回填默认值

在 `alterTableAddColumn` 中，若新字段定义了 `defaultValue`，在 ALTER TABLE 后执行 `UPDATE <table> SET <column> = ?` 回填存量行。

**理由**：SQLite 的 `ALTER TABLE ADD COLUMN ... DEFAULT` 仅在 3.35.0+ 支持，且 sql.js 基于较旧版本。UPDATE 是可靠的跨版本方案。

**备选方案**：不处理存量行 → 放弃。存量行 `NULL` 会导致查询一致性问题和筛选器无法正确过滤。

## Risks / Trade-offs

- **风险**: `defaultValue` 类型可能与字段类型不匹配 → **缓解**: 不做运行时类型校验，信任 schema 定义时用户已确保一致性。与现有行为一致（`data[name]` 也不做类型校验）。
- **风险**: `alterTableAddColumn` 的 UPDATE 需要全表扫描 → **缓解**: 仅在添加带 `defaultValue` 的字段时执行，且 SQLite 表通常不超过 10,000 行（平台限制）。
