# 简历管理本地验收

该应用由 builtin `localapp init` 生成，使用统一 Server 的 authenticated content upload 和 named SQL，并将页面设为 owner-only。数据库只保存候选人、文件 key、原始文件名、MIME、大小和 owner 元数据。

验收目标：

1. 使用文件上传控件上传 `portrait.png` 与 `resume.pdf`，创建两条简历记录。
2. 所有者从受页面权限保护的 content URL 加载图片并进行可访问预览，可打开 lightbox、下载原始 bytes；未登录用户和其他用户不能读取文件。
3. PDF 使用模板固定的 `react-pdf@10.4.1`、`pdfjs-dist@6.1.200` 和本地 worker 预览，可翻页并下载原始 bytes。
4. 记录列表、元数据和删除操作经过 named SQL；另一用户不能读取或删除当前用户的记录。

正式入口必须是 `/<owner>/resume-manager/`；`/serve/` 仅作 API 诊断。
