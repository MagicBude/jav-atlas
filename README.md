# JAV Atlas

基于 minnano 与 JavDB 的演员资料采集与浏览项目。GitHub Actions 定时抓取 JSON 与头像，浏览界面后续提供检索、筛选和榜单浏览。保留来源站点 ID，不引入数据库或额外人物编号。

## 快速开始

需要 Node.js 22+。采集和测试均无第三方依赖，无需 npm install。

```sh
npm run check
npm test
npm run collect -- smoke all
```

smoke 会抓真实数据：每个影片维度 1 页、资料页最多 3 人、榜单头像最多 3 人，禁用 JavDB 图片和网页性别复核。不是 dry-run。榜单仍最多抓日/周/月各 2 页。缺少性别依据的记录保留 ?。

可单独选择来源排查网络：

```sh
npm run collect -- smoke minnano
npm run collect -- smoke javdb
npm run collect -- smoke male
npm run collect -- daily all
```

daily 使用正常任务量；male 是固定种子工具，all 的演员集合采集已覆盖影片中发现的男女演员，不再重复运行种子搜索。

## 空数据冷启动

minnano 顺序：榜单 → bootstrap-roster 建立初始名册 → 资料回填 → 女性名字集合 → daily 时补名册头像。

名册只包含榜单发现并逐次累积的人物，不代表全站约两万多人的完整目录；不下载其他仓库的数据快照。已有名册条目和人工资料不会被冷启动覆盖。

JavDB 可独立从影片发现演员 → 拉资料 → 采无码出演名单 → 更新女性姓名集合。缺少名册时仍能抓人物，性别无法确认便保留未知，不默认男性。

## GitHub Actions

推送代码后打开 Actions → Collect atlas data → Run workflow，先选 smoke 和 all；也可分别选择 minnano/javdb/male 排查。失败时下载 collected-data 查看已完成步骤的产物；只有整次所选流程成功才自动提交 relay/。

定时计划为北京时间每天 05:30。**默认只开放手动执行**；确认 smoke 与 daily 符合预期后，在 Settings → Secrets and variables → Actions → Variables 添加 ENABLE_SCHEDULE，值为 true。不要为此禁用整个 Actions，否则也无法手动验证。

workflow 需要 contents: write；仓库或分支规则仍可能限制自动提交。GitHub 托管 runner 提供独立网络出口，不保证源站始终可访问。

## 目录与配置

- tools/：采集器、统一入口、名册启动及公共 JSON/路径工具。
- tests/：隔离临时目录中的合成网络测试，不访问源站或写项目数据。
- relay/minnano/：minnano 榜单、人物名册与头像。
- relay/javdb/：JavDB 演员、出演名单、男演员种子与共享头像。
- relay/derived/：跨来源姓名索引与补图资料/图片。
- .cache/：可忽略的本地测试数据或资料缓存。
- web/：React + TypeScript 浏览端，支持人物筛选、详情、收藏、本地编辑和备份；启动方式见 [浏览端说明](web/README.md)，新手从 [代码阅读指南](web/LEARNING.md) 开始。

目录路径统一由 tools/lib/data-paths.js 管理，RELAY_DIR 只覆盖数据总根，不改变内部来源分类。RELAY_DIR 可覆盖产物目录，CACHE_DIR 可覆盖资料缓存目录；相对路径以工作目录为准。MOVIE_PAGES、UC_PAGES、PROFILE_LIMIT、AVA_LIMIT、FIX_LIMIT、AVA_CONC 等控制任务量，整数配置会校验范围。HTTP_TIMEOUT_MS 控制主要请求超时。WEB_GENDER=0 禁用网页复核，SKIP_IMAGES=1 禁用 JavDB 头像任务；榜单头像需用 AVA_LIMIT=0 单独关闭。

数据文件均按来源命名并多行保存，详见 [数据目录说明](relay/README.md)。头像按来源 ID 与姓名命名并继续自行抓取，不接入外部头像库；[头像缓存说明](docs/avatar-sources.md) 记录了命名依据与备选方案调研。

阅读：[工具索引](tools/README.md)、[架构](docs/architecture.md)、[代码规范](docs/code-style.md)、[验证记录](docs/validation.md)。

## 当前边界

旧 JavDB 人物详情仍直接复用，没有定期刷新。网页性别复核仍使用同步 curl，三个人工修复工具仍有各自失败规则。照片允许部分失败；多个脚本的文件写入不是整体事务。本地流程中已完成步骤的产物不会因后续失败回滚。

当前 pending user acceptance；离线测试成功不代表源站完整性或人物身份已人工验收。

## 授权状态

尚未声明开源许可证，代码授权范围仍待确认。
