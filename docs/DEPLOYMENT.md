# 部署与成本

更新：2026-09-26。目标是两人私用、免费额度优先，保留现有 Supabase 数据和域名。

## 本次发布进度

- GitHub 仓库：`overlighta/Firefly`；生产分支：`codex/deploy-private-journal`。`master` 仍为旧版本，不应选为生产分支。
- Cloudflare Pages 项目已连接 GitHub，推送生产分支会自动构建发布。平台地址：https://firefly-i7p.pages.dev 。
- 正式域名：https://together0624lyx.com 。域名在 Spaceship 续费，DNS 已交由当前 Cloudflare 账号的 dion/jill 名称服务器管理；根域名 CNAME 指向 Pages 项目。
- 浏览器使用 Supabase publishable key；环境文件、测试账号文件及本地初始化 SQL 不上传。构建会检查输出是否包含本地密钥。
- 本轮手帐与城市选择改版保持相同部署架构，无新增环境变量、SQL 迁移或付费接口。

## 推荐方案

优先复用用户现有的 **Cloudflare 静态托管 + Supabase Free**，核实原项目后选择 Pages 或 Workers Static Assets；Vercel 保留为备选。此次没有引入常驻服务器、SSR、图片转换服务或付费后台；Astro 负责构建，浏览器中的 Svelte 应用负责交互。无需为框架迁移重新购买云服务器。

| 项目 | 起步费用 | 需要关注 |
| --- | --- | --- |
| Vercel Hobby | 免费 | 适用于个人非商业用途，受平台额度限制 |
| Supabase Free | $0/月 | 数据库 500 MB、文件 1 GB；5 GB 普通出口 + 5 GB 缓存出口 |
| 现有域名 | 按注册商续费 | 网站托管免费不代表域名免费 |
| Cloudflare 静态托管（优先） | 静态资源请求免费 | 已准备 Pages 路由和响应头配置；如原项目为 Workers，需核实配置后发布 |

价格核对来源：[Supabase](https://supabase.com/pricing)、[Vercel Hobby](https://vercel.com/docs/plans/hobby)、[Cloudflare 静态请求](https://developers.cloudflare.com/pages/functions/pricing/)。

Supabase 免费项目连续一周不活跃可能暂停，而且不包含自动备份；Pro 从 $25/月起，不建议仅因本次改版直接升级。后续先观察 Storage 容量与出口用量，再决定是否升级或单独迁移照片。以每张压缩后 300 KB 作估算，1 GB 大约对应三千张照片；实际大小随画面、格式和压缩结果变化，HEIC 等浏览器无法解码的文件不会被压缩。

## Vercel 发布配置

- 项目目录：仓库根目录。
- Node.js：22.12 或更新的 22 系列。
- 安装：`pnpm install --frozen-lockfile`。
- 构建：`pnpm build`。
- 输出：`dist`。
- 环境变量：只设置 `PUBLIC_SUPABASE_URL`、`PUBLIC_SUPABASE_PUBLISHABLE_KEY`，Production 和 Preview 分别检查。
- 不上传管理员密钥、测试账号密码、`.env.local`、`.test-accounts.local.txt` 或本地初始化 SQL。

`vercel.json` 已包含私有页面禁止索引响应头、基本安全响应头、指纹资源长期缓存，以及 `/memory/{uuid}/` 到 `/memory/` 的内部重写。不要改成跳转，否则会丢失详情 URL 中的记忆 ID。

部署前运行：

```sh
pnpm check
pnpm type-check
pnpm test
pnpm build
pnpm preview
```

预览运行后，另一个终端执行 `pnpm test:browser`。本地浏览器测试需要两个测试账号，CI 的类型、缓存和构建检查不需要管理员密钥。

先创建平台预览部署，验证两人登录、切换、详情刷新、图片和退出，再将部署提升为正式版。此次本地改版不会自动替换线上网站。

## 现有域名和旧内容

现有域名为 `together0624lyx.com`，正式发布时优先复用已绑定该域名的 Cloudflare 项目；核实项目归属与部署类型，避免重复创建。如果最终改用 Vercel，再按下一段调整解析。Cloudflare 若代理外部源站，开启 **Full (strict)**，并检查 **Always Use HTTPS**；部署完成后检查旧站缓存。

域名操作顺序：在 Vercel 对应项目的 **Settings → Domains** 添加或检查这个域名，再到当前 DNS 服务商填写 Vercel 此刻显示的 A / CNAME 记录，等待显示配置有效和 HTTPS 证书就绪。已正确绑定时无需重复改 DNS。域名可以继续在原注册商管理，只调整网站相关记录，不必转移域名或变更邮件记录；解析值以项目后台为准。见 [Vercel 自定义域名说明](https://vercel.com/docs/domains/working-with-domains/add-a-domain)。

2026-09-26 实测旧线上域名的 HTTP 返回 200，未跳转到 HTTPS，也没有新项目的禁止索引响应头。因此，本地构建通过不能视为线上切换完成。旧博客在新构建中已无页面或资源，历史线上缓存需随新部署清除；旧文章地址应返回 404，不应重定向到某篇私人记忆。

上线后检查：

1. HTTP 跳转 HTTPS，新页面具有 `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet`。
2. 两个账号都可访问同一空间；未登录不能读取私有数据。
3. 从详情复制 URL，在新标签直接打开和刷新均可恢复正确记忆。
4. 原博客文章、RSS、公开搜索索引和旧 API 不再由当前部署提供。
5. 手机搜索按钮可点，底部导航不遮挡顶部操作；退出后私有内容立即消失。

## Cloudflare 发布（优先复用原项目）

先进入 Cloudflare 后台的 **Workers & Pages**，打开原站点，确认项目名称、类型、Git 仓库与生产分支。旧仓库包含 `firefly` 的 Workers 静态资源配置，这只能作为线索，不能代替账号内的真实部署状态。

如果是 Pages：构建命令 `pnpm build`，输出目录 `dist`，项目根目录为仓库根目录；构建环境配置 `NODE_VERSION=22`、`PNPM_VERSION=9.14.4` 和两项 `PUBLIC_SUPABASE_*` 变量。`public/_redirects` 和 `public/_headers` 会进入 `dist`，为详情重写、安全响应头及资源缓存提供配置。应用不需要 Pages Functions。

如果是 Workers：确认项目后补充匹配该项目的 Static Assets 部署配置，只发布静态构建；不恢复旧博客的 KV、占位登录或旧 API。详情刷新和旧链接 404 需在平台预览中验证。静态资源请求免费，见 [Workers Static Assets 计费](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)。

此前本地移除了旧 Worker 配置，云端部署不会因此自动删除。复用、替换或停用操作需根据已确认的线上项目进行。

## Supabase 设置与升级

当前项目已由用户执行 `supabase/updates/20260926_private_app.sql`，随后真实账号验收通过：新建事务、重复请求、两人权限、存储清理和临时数据清理。

用户已选择暂时保留注册，本次部署沿用此设置。以后收紧为固定两人时，可在 **Authentication → Sign In / Providers** 关闭 **Allow new users to sign up**，保留 Email 登录。设置正式域名为 Site URL；需要预览登录回跳时，仅加入自己的预览地址。管理员密钥只保存在本地，不参与浏览器构建。

## 备份与恢复

免费数据库不提供自动备份，照片文件也不能依赖数据库元数据备份来恢复。正式存放唯一副本前，为数据库和 `memory-images` 各保留一份加密的独立备份；建议每月及大量上传后执行一次，另存一份离线副本。

数据库备份应包含完整表结构、RLS、函数及数据，照片备份需保存文件内容和原 `storage_path`。迁移文件保留于仓库。恢复时先在独立测试项目还原结构、账号与数据，再按原路径还原照片，验证两人访问、文件签名和删除权限后再切换生产。

目前未执行完整灾难恢复演练，也未替用户开通付费备份；不要把现有验收解释为已具备自动恢复能力。

## GitHub 自动发布设置

在创建应用页面先选择 Continue to Pages，再连接 GitHub 的 `overlighta/Firefly`。生产分支选择 `codex/deploy-private-journal`，框架 Astro，构建命令 `pnpm build`，输出 `dist`，根目录留空。设置 `NODE_VERSION=22`、`PNPM_VERSION=9.14.4`、`PUBLIC_SUPABASE_URL`、`PUBLIC_SUPABASE_PUBLISHABLE_KEY`。后两项使用现有本地配置中的同名值；管理员密钥和测试密码不上传。

后续推送到该生产分支会自动发布，其他分支用于预览。若以后改用 `master`，先合并新版，再修改 Pages 的生产分支设置。
