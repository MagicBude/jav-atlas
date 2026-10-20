# 采集架构

源站 → collect.js 顺序任务 → relay JSON / 头像 → 浏览端。采集与浏览分开，保留 minnano mnid 和 JavDB id，不以同名自动合并人物。

## 统一入口与冷启动

collect.js 提供 smoke/daily 两种规模及 all/minnano/javdb/male 四种来源选择。默认 smoke all，任一步非零退出立即停止后续任务。

minnano 先采 minnano-rankings.json，bootstrap-roster 读取三种榜单新增 mnid，再由 profiles 回填、生成名字集合，daily 最后执行每日 400 人的头像补齐。名册仅覆盖榜单发现者；全站目录发现尚未实现。

JavDB 的 actors-full-crawl 从三个影片维度发现人物，合并旧资料；uncensored-actresses-crawl 从 type=1 影片建立出演样本；最后累计女性名字。male 模式为固定种子搜索，不作为全库目录。

## 公共工具

tools/lib/runtime.js 统一 relayDir、只忽略缺文件的 readJson、临时写入后替换的 writeJson，以及带范围校验的 envInt。默认目录固定仓库根 relay/，无需依赖启动工作目录；只有显式给出相对覆盖路径时才相对工作目录解析。

资料缓存位于 CACHE_DIR 或 .cache/profiles；仅成功记录受 20 小时 TTL 过滤，失败下次可重试。保存顺序为先名册后缓存，避免缓存宣称成功而资料尚未保存。ONLY/full 仍受成功缓存过滤。

## 性别与质量保护

女性姓名集合命中为 f；已确认人物 gender 可复用；其他待网页复核。无法确认时为 ?、genderSource 为 unverified，不用男性或女性默认值填补。统计分别计算女性、男性、未知。

演员详情复用只针对已有 ID，不刷新旧条目。已确认记录直接复用，未知记录会在后续运行重新尝试姓名反查和网页确认；补图映射读写统一采用 { fetchedAt, count, map }。

分页请求失败、空发现、全部新增详情失败及损坏的关键 JSON 会中止，不把失败伪装为完整更新；部分图片失败仍允许输出。无码女性人数异常下降的保护分支会明确非零退出。JSON 单文件替换不能保证整个目录事务一致。

## 自动任务

一个工作流串行运行所有选定步骤，并用共享 concurrency 组避免多个运行同时提交。失败上传现场但不提交；成功提交 relay/，包括女性姓名集合。提交期间如果有人同时向分支推送，仍可能发生 push 冲突，任务不会强推覆盖。

默认禁用定时任务的实际执行，手动验证后用仓库变量 ENABLE_SCHEDULE=true 开启。未配置跨 runner 缓存，不保证 Actions 下次复用本地资料缓存。

浏览网站尚未实现。网页 curl 的异步化、旧资料刷新和完整目录发现留作后续独立改动。
