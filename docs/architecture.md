# 采集架构

数据流为：源站 → GitHub Actions → 采集脚本 → relay JSON / 头像 → 浏览网站。采集与浏览解耦，网站无需在用户每次查阅时请求源站。

## 数据链路

minnano 的 rank-relay 解析日、周、月榜，写 rankings.json 并抓取部分榜上头像。roster-avatars 根据已有 roster.json 和榜单补图；profiles-relay 根据名册中的 mnid 回填资料。这两项不会自行创建完整名册。

JavDB 的 male-roster-relay 从固定姓名种子搜索人物。actors-full-crawl 从全部、有码、无码三个影片维度发现人物并合并旧结果；uncensored-actresses-crawl 从 type=1 影片发现出演人物并保存编号样本。gen-female-names 汇总女性姓名，为两项演员采集提供反查输入。

三个 fix/verify 工具用于人工复核；输入路径、代理配置和输出覆盖方式各不相同，详见工具文件顶部说明。

## 标识与产物

minnano 使用 mnid，JavDB 使用 id；人物姓名和别名用于检索，不作为跨来源唯一标识。数据以 JSON 与本地图片文件保存，不引入数据库。输出目录以各脚本配置为准，工具索引列出了 tools/relay 与根 relay 的区别。

## 运行边界

工作流的 concurrency 仅限制各自任务重叠；四个工作流之间仍可能存在提交竞争。网页与 API 的可达性独立，机房或家庭网络均可能受源站限制。

当前不预置采集数据，尚未实现无数据冷启动、统一端到端运行入口或浏览网站。只有完成手动小规模验证后，才能判断采集、数据和消费链路是否可用。
