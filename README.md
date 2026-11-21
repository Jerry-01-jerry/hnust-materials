# 湖科资料库

面向湖南科技大学学生的免费资料站。使用 Next.js 14 App Router、React 18、Tailwind CSS 3 和 Supabase。

## 启动

```sh
npm ci
npm run dev
```

打开 http://localhost:3000。首次配置时复制 `.env.example` 为 `.env.local`，填写项目 URL、匿名 key、服务端 `SUPABASE_SERVICE_ROLE_KEY` 和 `ADMIN_PASSWORD`。生产 HTTPS 环境设置 `ADMIN_SECURE_COOKIE=true`。使用 `npm run build` 验证生产构建，并用 `npm start` 启动。

## 页面文件清单

| 页面 | 路由 | 入口 | 相关文件 |
| --- | --- | --- | --- |
| 首页搜索 | `/` | `app/page.jsx` | `components/Catalog.jsx`、`components/CatalogFilters.jsx` |
| 课程列表 | `/courses` | `app/courses/page.jsx` | `components/Catalog.jsx`、`lib/catalog-data.js` |
| 资源详情 | `/resources/[id]` | `app/resources/[id]/page.jsx` | 同目录的 `actions.js`、`download/route.js`，以及 `components/ResourceFile.jsx` |
| 上传资料 | `/upload` | `app/upload/page.jsx` | `app/upload/actions.js`、`lib/catalog-data.js` |
| 管理后台 | `/admin` | `app/admin/page.jsx` | 同目录的 `queue.jsx`、`actions.js`、`access.js` |

共享提交表单和分页组件分别位于 `components/ActionForm.jsx` 和 `components/Pagination.jsx`。字段、枚举、权限与 Storage 约定见 [docs/API.md](docs/API.md)。

## 联调步骤

1. 在首页搜索标题或教师名，按学院、专业、课程、年份筛选。首页资源来自 `v_resources_public`。
2. 在上传页选择课程并提交 PDF、图片或 Word 文档。昵称选填，成功后显示「提交成功，待审核。」待审资源对匿名访客不可见。
3. 在 `/admin` 输入管理密码，从上传审核队列预览并通过测试资料。后台按 API 文档使用 HttpOnly Cookie 验证身份，再在服务端调用 Supabase 的管理方法。
4. 在首页按标题找到已发布资料，打开详情预览和下载。下载通过 RPC 计数。匿名评论提交后待审核，举报由管理员标记处理结果。
