# JavDB作品评分与评论小样本验证

日期：2026-10-22。范围：现有minnano作品中的3部；只读调用接口，结果保存在本机.cache/javdb-work-probe，不修改relay原记录，不下载封面、样片或视频。正式网站尚未接入这些补充数据。

## 获取方式

复用本项目既有JavDB移动端请求方式：番号搜索 `v2/search?type=movie&page=1` → 精确候选 → `v2/movies/<id>` → `v1/movies/<id>/reviews?page=N`。

本次比较只做NFKC、大写、去非字母数字，不删除数字前导零，不使用唯一搜索结果兜底。3部作品都从10个搜索结果中找到唯一精确番号候选，详情返回番号再次校验。候选身份保留minnano ID与JavDB ID两套，不用一个ID替换另一个。日期和出演者作为交叉核对证据，有冲突时保留来源差异，不能悄悄覆写。

## 实际结果

- minnano 554381 / MFYD-195 → JavDB Rk8074。评分3.26，reviews_count=465，comments_count=3。评论第1页4条，第2页0条。时长120分钟，两站发行日期均2026-09-15。JavDB比minnano多列出其他出演者。
- minnano 154346 / SONE-758 → JavDB YwrOPe。评分4.4，reviews_count=8812，comments_count=99。评论第1页10条、第2页10条，跨页ID无重叠。时长180分钟，两站日期均2025-07-08，出演者均包含瀬戸環奈。
- minnano 116175 / OFJE-625 → JavDB e87z2z。评分4.25，reviews_count=408，comments_count=2。评论第1页2条，第2页0条。时长240分钟。minnano日期2026-04-09，JavDB日期2026-04-14；出演者集合亦不同，应标记来源冲突，不能直接确认全部字段一致。

评分为接口字符串，应保留原始值并另行转有限数值用于展示。`reviews_count`和`comments_count`是不同字段，不能把前者写成“已抓评论总数”，也不能保证后者等于本次可遍历文本条数；第一部样本已出现3与4不一致，原因尚未确认。界面适合展示“JavDB评分”“来源评价数”“已保存短评数”各自口径。

## 确认可取得的字段

详情实际有number、title、duration、score、reviews_count、comments_count、want_watch_count、watched_count、maker_name、publisher_name、director_name、series_name、tags、actors、thumb_url、cover_url、release_date及预览图片URL等。存在字段不代表每部有值：样本中导演与系列均有缺失。没有确认独立剧情简介字段，不能拿标题充当简介。

评论实际含id、username、score、content、likes_count、created_at、status_title等。原始响应包含其他用户字段，正式保存应只取展示需要的公开字段，按评论原生ID去重。评论按纯文本渲染，不执行HTML。

## 对原项目记录的修正

javpaco的server.js约12423行注释曾记录“最热6条、第二页为空”。本次SONE-758实测前两页各10条，且ID不重复，因此该限制不能继续视为当前事实。尚未继续遍历后续页，也未验证接口默认排序，所以不能宣称可以取到全部评论或已确认按热度排序。后续应按实际分页去重、限制预算，并识别整页重复与空末页。

## 推荐接入方式

minnano继续保存人物与作品关系。另设relay/javdb/work-enrichment，按JavDB原生作品ID保存元数据和评论；匹配映射按minnano作品ID保存候选、番号校验和日期/出演者差异。评分、评论更新时间独立于作品详情，不必每天重抓静态发行资料。

先只接入这3部的只读评分和有限评论预览，冲突来源并排展示；评论数量明确“已保存N条”，不要直接称全量或固定热门6条。随后再评估96部批量补充，按预算采集，并对不匹配/多候选留待人工核对。本次没有启用批量或定时补充。

## 三部样本网页接入

2026-10-22将已验证快照导入relay/javdb/work-enrichment：records按JavDB原生ID保存，mappings按minnano作品ID保存唯一精确番号匹配依据与日期差异。原始minnano作品未修改。仅导入三部，未启用刷新采集器或定时任务。

详情页按需加载独立补充资源，展示评分、评价数、时长、厂商、导演、系列、出演者、标签和已保存短评；评论只显示前两页样本条数，不宣称全量或最热。正文由React转义为纯文本，保留换行。转换只保存公开展示字段，不导入评论用户内部ID及资源链接。数据取得时间与来源链接可查。
