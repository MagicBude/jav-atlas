# 采集架构

源站 → collect.js 顺序任务 → relay JSON / 头像 → 浏览端。采集与浏览分开，保留 minnano mnid 和 JavDB id，不以同名自动合并人物。

## 统一入口与冷启动

collect.js 提供 smoke/daily 两种规模及 all/minnano/javdb/male 四种来源选择。默认 smoke all，任一步非零退出立即停止后续任务。

minnano 先采 minnano/rankings.json，bootstrap-roster 读取三种榜单新增 mnid，再由 profiles 回填、生成名字集合，daily 最后执行每日 400 人的头像补齐。名册仅覆盖榜单发现者；完整目录发现使用独立 directory 入口分批执行，当前名册覆盖范围以 directory-progress.json 的实际进度为准。

JavDB 的 actors-full-crawl 从三个影片维度发现人物，合并旧资料；uncensored-actresses-crawl 从 type=1 影片建立出演样本；最后累计女性名字。male 模式为固定种子搜索，不作为全库目录。

## 数据目录

relay/minnano 保存该站名册、榜单和原生 ID 头像；relay/javdb 保存演员资料、无码出演名单、固定姓名种子结果和共享 JavDB ID 头像；relay/derived 保存跨来源名字索引、补图关联与补图缓存。原生人物表不合并身份。

路径唯一约定在 tools/lib/data-paths.js，所有采集器都引用同一组路径。新增来源不需要在多个采集器中重复硬编码目录。文件按需生成，不用空产物伪造完成状态。

## 公共工具

tools/lib/runtime.js 统一 relayDir、只忽略缺文件的 readJson、临时写入后替换的 writeJson，以及带范围校验的 envInt。默认目录固定仓库根 relay/，无需依赖启动工作目录；只有显式给出相对覆盖路径时才相对工作目录解析。

资料缓存位于 CACHE_DIR 或 .cache/profiles；仅成功记录受 20 小时 TTL 过滤，失败下次可重试。保存顺序为先名册后缓存，避免缓存宣称成功而资料尚未保存。ONLY/full 仍受成功缓存过滤。

## 性别与质量保护

JavDB 人物资料主要来自移动 API，按代码定义选取字段；minnano 从 HTML 解析生日、尺寸、别名、简介等字段。两者均不保存完整响应或网页，不代表源站所有资料都已收录。本轮抽查 JavDB 演员详情的 actor 对象未返回 gender/sex 字段；已知男演员与女演员的 type 都可能是 0，因此不能把 type 当作性别。

网页性别证据独立保存在 javdb/web-genders.json，按原始 ID 记录 gender、sectionMeta 原文数组、sourceUrl 和 checkedAt。只有男性标记或明确作品数标签才能用于确认，别名标签本身不足以判为女性；请求失败或无有效标签时不写假证据。公共解析与保存代码位于 tools/lib/gender-evidence.js。

本地 verify-genders.js 使用可选代理真正并发读取网页，跨集合去重、即时保存依据、定期应用检查点；新采集读取同一份证据，即使 Actions 网页被拦也能保留本地确认结果。单文件复核与采集器成功读取网页时同样保存依据。没有将本机代理地址配置到 Actions；它无法访问用户电脑的 127.0.0.1。

女性姓名集合命中为 f；已确认人物 gender 可复用；其他待网页复核。无法确认时为 ?、genderSource 为 unverified，不用男性或女性默认值填补。统计分别计算女性、男性、未知。

演员详情复用只针对已有 ID，不刷新旧条目。已确认记录直接复用，未知记录会在后续运行重新尝试姓名反查和网页确认；补图映射读写统一采用 { fetchedAt, count, map }。

分页请求失败、空发现、全部新增详情失败及损坏的关键 JSON 会中止，不把失败伪装为完整更新；部分图片失败仍允许输出。无码女性人数异常下降的保护分支会明确非零退出。JSON 单文件替换不能保证整个目录事务一致。

## 自动任务

一个工作流串行运行所有选定步骤，并用共享 concurrency 组避免多个运行同时提交。失败上传现场但不提交；成功提交 relay/，包括女性姓名集合。提交期间如果有人同时向分支推送，仍可能发生 push 冲突，任务不会强推覆盖。

默认禁用定时任务的实际执行，手动验证后用仓库变量 ENABLE_SCHEDULE=true 开启。未配置跨 runner 缓存，不保证 Actions 下次复用本地资料缓存。

浏览网站尚未实现。批量网页复核已有异步 curl 入口；普通采集器内部网页请求仍同步。旧资料刷新仍待后续改动；目录发现已经提供独立分批入口。

## minnano 目录发现

`npm run discover:minnano -- --pages 20` 从上次检查点继续读取源站按追加日期排序的人物目录；`--start-page 1 --pages 3` 可刷新前几页，不倒退已有全量进度。基础名册以 mnid 去重，仅补缺失字段，不覆盖已有姓名、详细资料和人工字段。每页先保存名册再保存 directory-progress.json，失败不会推进到未成功的页面。

Actions 选择 mode=daily、source=directory，每次最多发现20页；smoke+directory只读1页。该入口不下载详细资料或头像，后续按需要另行回填。遍历期间源站新增和排序变化可能造成跨页重叠或遗漏，一轮扫描完成仍需定期重扫，不能把源站显示人数当成本地完整人数。定时任务仍保持关闭。

目录页脚存在已实测的退化情况：按追加日期排序的第11页曾显示11/11（330件），但第12页仍有数据。发现器保留当前扫描及历史检查点中已见的最大分页范围，避免将这类页脚当作完成。首次目录显示831页、24922人属于源站当时的报告值，不代表已收录人数。

目录深页补充：普通无筛选目录实测第168页会返回第167页，因此当前 Actions 的 directory 使用 discover-minnano-groups.js 按公开五十音分组扫描。directory_pages 是所有分组共享的本轮总页数预算（默认20），检查点保存 partitionPlan 与 groups 中各组进度；partitionCompleted=true 只表示计划中的分组已遍历，不表示未分类人物也全部覆盖。原始普通目录进度保留用于诊断。单组诊断可运行 discover-minnano.js --gojuon a --pages 3。
