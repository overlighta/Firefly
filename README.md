# 我们 · 私人生活手记

供两个人记录日常的私密网站：今日记录、时间轴、回忆、足迹、共同空间和记忆搜索。旧博客文章、RSS、标签、公开搜索索引、博客组件和旧 Worker 已从项目中移除。

## 本地使用

需要 Node.js 22.12+、pnpm 9.14.4。复制 `.env.example` 为 `.env.local`，填写两项公开连接配置。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

重置后的测试账号及密码保存在本机 `.test-accounts.local.txt`，该文件与 `.env.local` 都不会进入 Git。不要把它们上传至部署平台。需要重新重置时，`node scripts/setup-test-accounts.mjs` 先检查配置，加 `--apply` 才修改现有两人的登录信息并生成新密码；原用户 ID 与记忆归属保持不变。

## 实现

- Astro 只生成静态入口；Svelte 维护单个应用、导航和登录状态。五个主要视图共享数据并保留状态，切换不重新获取整页 HTML。
- 当前使用 Astro 7.3.5、Svelte 5.57.1 及配套集成。锁文件已更新安全补丁；`yaml-language-server` 上游仍固定旧 YAML，暂通过同一主版本的 2.9.0 覆盖修复。
- Supabase 提供账号、Postgres、实时通知和私有照片存储。所有私有查询在登录后通过行级权限执行。
- 缓存绑定账号与数据版本；读取期间发生更新会补查，退出登录后清空缓存。没有后台定时轮询。
- 历史记录分批完整读取，取消原先 200/300 条静默截断。新记忆及第一段文字由数据库事务一起保存，并支持同一请求重试。
- 私有图片按需要签发短期访问链接，缓存仅存在内存。浏览器可解码的图片上传前压缩到最长边 1920 像素；HEIC 等无法解码的文件保留原文件。
- 搜索在登录后读取的记忆中进行，不生成公开搜索索引。
- 动效使用原生 CSS 与浏览器动画：导航高亮平滑移动、内容进入视野时浮现、卡片悬停、表单及照片过渡。切页不等待动画结束，系统减少动态效果设置实时生效，无额外动画依赖。

## 验证

```sh
pnpm check
pnpm type-check
pnpm test
pnpm build
pnpm preview
```

`pnpm build` 同时检查旧页面残留和本地密钥泄漏。预览默认地址 `http://127.0.0.1:4328`，支持直接刷新记忆详情 URL。

配置 `.env.local` 中的两个测试账号后运行 `pnpm test:browser`，覆盖桌面和手机、主要导航、详情刷新、搜索、返回和退出。预览地址不同时设置 `TEST_BASE_URL`。需要本机 Chrome/Edge，或先安装 Playwright Chromium。

连接真实数据库的验收：

```sh
pnpm audit:storage
node scripts/audit-memory-creation.mjs
```

这两项会创建专用临时记录并清理，用于验证存储权限、事务、重试与两人权限边界。

## 数据库和部署

现有项目升级执行 `supabase/updates/20260926_private_app.sql`。全新数据库按时间顺序执行 `supabase/migrations/`，另行初始化两个账号、个人资料及共同空间。

优先复用原 Cloudflare 静态托管项目和 Supabase Free，确认原站为 Pages 或 Workers 后发布；Vercel 配置保留为备选。先不购买服务器、不迁移现有数据。配置、费用边界与上线验证见 [部署说明](docs/DEPLOYMENT.md)，当前已验证和待处理事项见 [安全与验收记录](docs/SECURITY-AUDIT.md)。
