// 重新导出 cn 函数，保持 shadcn 'add' 命令按 @/lib/utils 写入的预期不变。
// 实际实现位于 CLI 领地 @localapp/app-kit/lib/utils。
export { cn } from "@localapp/app-kit/lib/utils";
