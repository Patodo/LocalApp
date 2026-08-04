## Context

LocalApp 平台有三组前端页面，各自使用不同的视觉风格：

1. **服务器渲染页面**（`packages/server/src/routes/serve.ts`）— 登录、注册、强制改密、应用外壳，使用内联 CSS 的暗色主题（`#0f0f23` 底色、`#1a1a2e` 卡片、`#62b6ff` 强调色）
2. **Admin SPA**（`packages/admin/`）— 6 个管理页面，React + Tailwind CSS，暗色侧边栏 + 浅色内容区混搭
3. **Profile SPA**（`packages/profile/`）— 4 个个人中心页面，React + Tailwind CSS，全暗色

端到端测试中通过 init-repo 模板生成的 BUG Tracker 应用采用了统一的浅色卡片风格（白卡片 + 浅灰底 `#f8f9fa` + blue-600 主色），视觉品质高于平台自身页面。

## Goals / Non-Goals

**Goals:**

- 将所有平台内置页面的视觉风格统一到 BUG Tracker 的设计语言
- 建立共享 CSS 基础（design tokens + 通用组件），消除三处独立维护
- 从 Admin 和 Profile SPA 中移除 Tailwind CSS 依赖，降低构建复杂度
- 保持所有现有功能行为不变

**Non-Goals:**

- 不引入 CSS-in-JS、CSS Modules 等新框架——保持和 BUG Tracker 模板一致的手写 CSS 方式
- 不做暗色模式切换——统一为浅色主题
- 不做响应式重构——Admin/Profile 当前面向桌面端，保持现状
- 不改动 init-repo 模板——模板已经使用目标风格
- 不修改任何后端 API 或数据结构

## Decisions

### D1: CSS 方案 — 纯手写 CSS + Custom Properties（非 CSS Modules）

**选择**: 单一 `shared.css` 文件定义 design tokens 和通用组件 class，各 SPA 页面通过 `<link>` 或 `@import` 引入。

**替代方案**:
- CSS Modules：Vite 原生支持，提供样式隔离，但需要每个组件配一个 `.module.css` 文件，增加文件数量且与 BUG Tracker 模板风格不一致
- UnoCSS：轻量 Tailwind 替代，但本质仍是原子化 CSS，未解决统一设计语言的核心问题

**理由**: 项目规模小（Admin ~1000 行 TSX + Profile ~1000 行 TSX），语义化 class（`.card`、`.btn-primary`）比 utility class 更可读、更易统一。手写 CSS 零依赖，和 BUG Tracker 模板完全一致。

### D2: shared.css 放置位置 — `packages/shared/styles/shared.css`

**选择**: 放在 `packages/shared/` 目录下，新增 `styles/` 子目录。

**理由**: `packages/shared` 已是 monorepo 的共享包，所有其他包都依赖它。将 CSS 放在此处，Admin 和 Profile 的 Vite 构建可以直接引用，serve.ts 的内联 HTML 也可以在构建时内嵌。无需新建包。

**构建集成方式**:
- Admin/Profile SPA：在 `src/main.tsx` 中 `import '@localapp/shared/styles/shared.css'`
- 服务器渲染页面：在构建脚本中将 shared.css 内容内联到 HTML 模板中，或者通过 `import` 在 serve.ts 中读取并嵌入 `<style>` 标签

### D3: Design Token 体系 — 直接采用 BUG Tracker 的 token

**选择**: 使用 BUG Tracker 已验证的 token 值，不做额外调整：

```css
:root {
  --bg: #f8f9fa;
  --surface: #ffffff;
  --border: #e2e4e9;
  --text: #1a1d23;
  --text-muted: #6b7280;
  --primary: #2563eb;
  --primary-hover: #1d4ed8;
  --danger: #ef4444;
  --success: #10b981;
  --warning: #f59e0b;
  --radius: 8px;
  --radius-lg: 12px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.05);
  --shadow: 0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06);
  --shadow-lg: 0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06);
  --font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  --transition: 0.15s ease;
}
```

### D4: Admin 布局改造 — 浅色侧边栏

**选择**: Admin 侧边栏从暗色（`bg-gray-900`）改为浅色（`--surface` 底色 + `--border` 分割线），与内容区统一为浅色主题。

**理由**: 暗色侧边栏 + 浅色内容区是两套视觉体系并存的根源。统一为全浅色后，所有组件使用同一套 token。

### D5: Tailwind 移除策略 — 一次性完全移除

**选择**: 不保留 Tailwind 做 reset，完全移除。Preflight reset 的效果通过 `shared.css` 开头的 minimal reset 实现（box-sizing + margin + padding reset）。

**替代方案**: 保留 Tailwind 仅用于布局 utility（flex、grid、gap）——但这样两套系统共存，class 命名风格混乱。

**理由**: 一次性移除避免混合态。布局用语义化 class（`.sidebar`、`.main-content`、`.card-grid`）同样清晰。

## Risks / Trade-offs

- **[视觉跳跃]** 用户登录时看到从暗色到浅色的巨大变化 → 可接受，平台尚在早期，无存量用户习惯
- **[Analytics 页面 Recharts 图表]** 图表组件使用内联样式，不受 CSS 框架影响 → Recharts 保持不变，只改外围容器和卡片样式
- **[服务器页面内联 CSS]** `serve.ts` 的 HTML 模板无法直接引用外部 CSS 文件 → 在构建时读取 shared.css 内容注入 `<style>` 标签，或直接在模板中硬编码简化版 token（服务器页面只有 4 个，token 量小）
- **[Profile/Admin 构建产物变化]** 移除 Tailwind 后 CSS 文件名 hash 会变化 → 自动处理，`npm run build` 重新生成即可

## Open Questions

无——探索阶段已解决所有关键决策。
