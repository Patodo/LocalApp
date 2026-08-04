---
name: localapp-ui
description: >
  LocalApp 应用 UI 开发指南。当前项目预置 shadcn/ui 全量组件。
  当用户要求美化界面、创建表单、列表、仪表盘、管理页、弹窗、筛选器、
  导航布局，或提到 shadcn、组件库、UI、交互体验时使用此 skill。
---

# LocalApp UI 组件开发

当前模板已经预置 shadcn/ui 全量组件源码，组件位于 `src/components/ui/`。

## 导入约定

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
```

优先使用 `@/components/ui/*` 和 `@/lib/utils`，不要复制新的组件库实现。

## 基础组件优先

默认用基础组件组合业务界面：

- 表单：`Label`、`Input`、`Textarea`、`Select`、`Checkbox`、`RadioGroup`、`Button`
- 数据展示：`Card`、`Table`、`Badge`、`Skeleton`、`Empty`
- 反馈与确认：`Alert`、`Dialog`、`AlertDialog`、`Sonner`
- 页面组织：`Tabs`、`Separator`、`ScrollArea`

除非用户明确需要复杂交互，不要把简单表单或列表做成多层弹窗、命令面板或大型导航。

## 复杂组件使用边界

以下复杂组件仅在需求明确匹配时使用：

- `Command` / `Combobox`：大量选项搜索、快捷命令、全局搜索
- `Popover`：轻量浮层选择器、筛选器、日期选择承载层
- `Calendar`：日期或区间选择
- `Carousel`：图片或内容轮播
- `Resizable`：可拖拽分栏工作台
- `Navigation Menu` / `Sidebar`：多页面或多模块应用导航
- `Chart`：统计图表或趋势分析

如果页面只有一个表单、一个 CRUD 列表或一个简单仪表盘，先用基础组件完成清晰可用的体验。

## LocalApp 应用模式

业务应用通常按这个结构组织：

1. 顶部区域显示当前用户、应用标题和主要动作
2. 中间区域使用 `Card` 承载表单、列表、详情或统计
3. 数据读取用 `useList` / `useGet` / `useCount`
4. 数据写入用 `useCreate` / `useUpdate` / `useDelete`，并在成功后 `refresh()`
5. 表单控件必须有 `Label htmlFor` 关联到对应控件 `id`
6. 加载、错误、空状态都要有可见 UI

## 视觉约束

- 让界面服务业务，不做组件陈列页
- 使用克制的间距、边框、背景和层级
- 不要用大量渐变、装饰性图形或单一色系堆满页面
- 操作按钮文字要具体，例如“添加任务”“保存资料”，不要只写“提交”
- 列表和表格要能快速扫描，重要状态用 `Badge` 标记
