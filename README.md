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

定时计划为北京时间每天 05:30，自动执行 `daily + ranked`，只维护三榜 Top250 的累积人物池。手动选择 `daily + ranked` 可立即运行同一流程。其他来源选项保留为维护工具，日常不执行全站目录和 JavDB 发现。

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

## 当前采集策略：三榜 Top250 累积人物池

日常使用 `npm run collect -- daily ranked`。Actions 默认选择 ranked，每天北京时间 05:30 自动执行（GitHub 可能延迟）。流程为日/周/月榜各五页共 Top250 → 按 minnano ID 去重累积 → 补齐池内缺失详情与头像。三榜当天最多750个不同人物，实际通常更少；曾上榜者落榜后仍保留，所以历史总人数会逐渐增长，并非永久上限750。

人物池保存在 relay/minnano/ranked-pool.json，记录首次和最近上榜时间。日常不遍历全站目录，不采 JavDB，不沿相关人物递归扩展。已有名册与图片保留为存档；网页只为池内人物生成 minnano 检索索引和详情。JavDB 旧数据仍可查阅，其采集工具保留为手动维护入口。

每轮最多补750人，可通过 profile_limit 调整至1–1000；详情已按当前结构成功保存的记录跳过，缺图独立重试。资料暂时继续只填空，日榜刷新不等于每个人物所有字段每天重新覆盖。作品列表尚未采集，后续将以人物池为范围设计，先保存源站作品ID、标题、发行日期、封面及链接，并独立分页与增量更新，避免把大型作品列表塞入人物索引。

本节是当前策略；前面的目录全量发现、all等说明保留为维护工具参考，不是每日任务范围。ENABLE_SCHEDULE变量不再控制当前定时计划；如需暂停，可在GitHub Actions禁用该工作流或修改schedule配置。

## 两人作品试采入口

`npm run collect -- daily works` 仅处理人物池中的190754与125605，默认每轮20个列表页、50份详情，串行请求并间隔至少500ms；本轮末尾额外复核已遍历人物首页。`WORK_PAGES`、`WORK_DETAILS`可覆盖预算，smoke模式固定2页与2份详情。超预算详情和分页断点保存至 `relay/minnano/works/progress.json`，后续同入口继续；失败产物由Actions保留，只有整批无请求/解析失败才自动提交。定时入口仍是ranked，works只手动运行。

作品原生ID对应一份records文件，people保存人物关系与占位，report记录真实完成范围。不会下载封面、视频或池外人物，也尚无网页作品展示。实现细节与限制见 [作品设计](docs/works-design.md)。
