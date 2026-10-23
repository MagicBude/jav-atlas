# 工具索引

从文件顶部 @file 了解输入输出，再沿阶段注释阅读流程和函数 JSDoc。命令从仓库根运行，要求 Node.js 22+，无需安装第三方依赖。

## 常用入口

```sh
npm run check
npm test
npm run collect -- smoke all
npm run collect -- smoke javdb
```

collect.js 顺序执行并在失败时停止。bootstrap-roster.js 仅从新榜单建立初始名册，不代表完整目录。公共 JSON 工具见 lib/runtime.js；数据文件与图片目录的唯一约定见 lib/data-paths.js。

## 采集器

rank-relay.js 解析三种榜单并补部分头像，默认无名册也可运行。roster-avatars.js 依赖已有名册，支持数字 limit、full/0，不创建新名册。profiles-relay.js 回填已有 mnid 的空字段；PROFILE_LIMIT 控制本轮人数，成功缓存 TTL 为 20 小时，失败下次重试。

actors-full-crawl.js 从三个影片维度发现人物，仅补新 ID，并按 map 结构复用补图缓存。uncensored-actresses-crawl.js 生成包含男女及未知的出演名单，uc_count 仅为本轮不同影片编号数。male-roster-relay.js 单独按固定种子搜索，不代表全站男演员目录。

gen-female-names.js 将当前名册和已标为女性的人物姓名合并进已有集合，没有女性输入时不写空文件。所有采集器写入 RELAY_DIR 下的 minnano、javdb、derived 分类；默认总根是仓库 relay/。male 模式明确输出 javdb/male-seed-actors.json，并与普通 JavDB 采集共用 javdb/avatars。

## 本地批量网页复核

```powershell
$env:WEB_PROXY = "http://你的本地代理地址:端口"
npm run verify:genders -- --ids ZX,K4m3Q,9gAX
npm run verify:genders
node tools/migrate-avatar-names.js
node tools/gen-female-names.js
```

verify-genders.js 按 ID 合并普通与无码名单中的未知人物，两个集合共用一次网页请求。默认真实并发为 2，GENDER_CONCURRENCY 可设为 1–4；--limit 限制本次任务量，--ids 显式选择抽样人物。成功依据逐条保存到 javdb/web-genders.json，定期写回人物性别和三类统计，失败保留原值；连续 15 次网络失败或收到 429 则暂停，可重新运行续抓；人物页跳转登录或已移除时保留未知。--report 可指定诊断 JSON 输出路径，区分登录限制、页面不可用和网络错误；本地诊断建议写入已忽略的 .cache/。已有依据会复用，人工来源不覆盖。代理地址只通过环境传入，不将个人代理配置写入公开仓库。

## 单文件人工复核

```sh
node tools/fix-gender-by-web.js input.json output.json
node tools/verify-gender-local.js input.json output.json
node tools/verify-uc-gender.js input.json output.json 4
```

这些工具依赖系统 curl，不在日常入口中自动执行。输入输出是示例路径；部分工具允许输出覆盖输入，没有自动备份。无人物标签的拦截正文均不能确认性别。三个单文件工具均使用公共判据并保存网页依据；这些旧单文件工具的同步 curl 仍是串行，批量任务优先使用上面的新入口。

格式与注释规则见 [代码规范](../docs/code-style.md)，采集验证范围见 [验证记录](../docs/validation.md)。

## minnano 目录发现

`npm run discover:minnano -- --pages 20` 从上次检查点继续读取源站按追加日期排序的人物目录；`--start-page 1 --pages 3` 可刷新前几页，不倒退已有全量进度。基础名册以 mnid 去重，仅补缺失字段，不覆盖已有姓名、详细资料和人工字段。每页先保存名册再保存 directory-progress.json，失败不会推进到未成功的页面。

Actions 选择 mode=daily、source=directory，每次最多发现20页；smoke+directory只读1页。该入口不下载详细资料或头像，后续按需要另行回填。遍历期间源站新增和排序变化可能造成跨页重叠或遗漏，一轮扫描完成仍需定期重扫，不能把源站显示人数当成本地完整人数。定时任务仍保持关闭。

目录深页补充：普通无筛选目录实测第168页会返回第167页，因此当前 Actions 的 directory 使用 discover-minnano-groups.js 按公开五十音分组扫描。directory_pages 是所有分组共享的本轮总页数预算（默认20），检查点保存 partitionPlan 与 groups 中各组进度；partitionCompleted=true 只表示计划中的分组已遍历，不表示未分类人物也全部覆盖。原始普通目录进度保留用于诊断。单组诊断可运行 discover-minnano.js --gojuon a --pages 3。

## 限量补齐人物详情和头像

Actions 选择 daily + profiles，profile_limit 默认20，允许1至1000；smoke 固定最多3人并跳过图片。该入口不更新榜单或发现目录，只选择名册中没有 profileFetchedAt 的人物，成功解析后记录时间，跨 runner 跳过已成功人物。仍按只填空原则保留已有资料。头像仅处理同批 ID，姓名和性别目录沿用现有规则。

本地可设置 BACKFILL_LIMIT 后运行 node tools/collect.js daily profiles。失败人物保留待重试状态；头像失败不会撤销已成功的详情，缺图可单独运行 node tools/roster-avatars.js 400 继续补齐。profileFetchedAt 表示详情解析成功时间，不代表源站提供了全部字段，也不表示图片成功。既有 daily + minnano / all 行为保持原范围。

每轮 profiles 生成 minnano/backfill-report.json：本批详情成功、失败、未尝试、缺头像计数，以及每个人物ID和结果。total为全名册成功详情与缺头像统计；缺少成功时间不等于失败，只有本轮失败缓存才计为失败。报告失败ID可用ONLY指定重试 profiles-relay.js；缺图可独立运行roster-avatars.js。该报告保留最新一批，历史批次可通过Git提交或Actions产物查看。

人物资料保留规范字段之外，profileFields保存资料表原始标签、文本和链接，relatedProfiles保存相关人物ID及姓名，既有rel继续保存ID列表。profileSchemaVersion=2表示该人物已执行原字段采集；旧版本即使有profileFetchedAt，也会重新进入限量补齐队列。源站没有提供的字段不补造，当前不包含全部作品列表或整页HTML，不能称为完整网页备份。

## 分批作品评分与基础元数据

运行npm run collect -- daily enrichment，默认每轮10部、30次请求；smoke只处理2部。只处理已有作品，严格番号搜索并再次验证详情身份；7天内成功资料复用，失败与待确认保存在relay/javdb/work-enrichment/progress.json。不会覆盖minnano资料，不请求评论/图片，不加入每日自动任务。HTTP429停止本轮并按来源要求退避。报告中的needsAttention包含无法匹配，不能把它当成已经全部完成。细节见docs/javdb-work-research.md。
