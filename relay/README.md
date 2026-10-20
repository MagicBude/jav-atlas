# 数据文件与头像约定

本目录由采集流程生成，可直接阅读 JSON；请通过代码或采集流程更新，避免修改后被后续运行覆盖。文件按两空格缩进、末尾换行保存，便于逐字段查看和 Git 对比。

## 当前文件

- minnano-rankings.json：minnano 日、周、月榜，字段 day/week/month 保持排名顺序。
- minnano-actresses.json：minnano 人物名册，只覆盖榜单发现并逐次累积的人物，不表示全站目录。
- javdb-actors.json：从影片中发现并累积的 JavDB 演员，包含男女与未知性别，不宣称全库。
- javdb-uncensored-actors.json：在采样的 type=1 影片中发现的出演人物，包含男女与未知性别，不是纯女性名单。
- female-name-index.json：已收集的女性名字及别名，用于反查，不是独立人物名册。
- javdb-male-actors.json：male 模式按固定姓名种子抓取的男演员资料，未运行时不存在。
- avatar-supplements.json：缺头像名册的补充资料映射，含 map 包装，补图步骤跳过时不存在。

## 文件名调整

- rankings.json → minnano-rankings.json。
- roster.json → minnano-actresses.json。
- actors_full.json → javdb-actors.json，去掉容易误解为全库的 full。
- uncensored_actresses.json → javdb-uncensored-actors.json，明确是男女混合的演员名单。
- female_names.json → female-name-index.json，明确内部姓名索引用途。
- roster_male.json → javdb-male-actors.json。
- actress_fix.json → avatar-supplements.json，明确是头像补充资料。

所有脚本、测试和文档已同步使用新文件名；旧 Raw URL 随重命名失效，需要更新外部引用，不并行保留两套产物。

## 头像文件

avatars/<mnid>.jpg 使用 minnano 人物 ID；avatars_jdb/<id>.jpg 使用 JavDB 人物 ID；avatars_male/<id>.jpg 为固定种子工具的 JavDB 图片缓存。补图没有 JavDB ID 时使用 mn_<mnid> 回退名。

人物姓名、别名和这些来源 ID 保存在对应 JSON 中。ID 文件名保持映射稳定，姓名变化不需要改文件名；同名人物也不会直接覆盖。按姓名查找的外部头像库需要另外解析其名字索引，不能把姓名当成全站唯一身份。

## 差异可读性

相同业务排序值的演员再按 ID 排序，姓名索引按字符串排序，减少并发完成先后导致的无意义重排。榜单保持排名顺序，名册保留已有顺序；fetchedAt 的变化表示本次抓取时间，不会为了让差异消失而隐瞒刷新。

JSON 展开会增加未压缩文件体积，这是换取阅读和提交审查便利的明确选择；网页可按需加载，后续有必要时再单独构建压缩分发产物。
