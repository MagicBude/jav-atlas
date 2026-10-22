# 数据目录约定

relay/ 只保存可供浏览端使用的资料及头像。来源资料与跨来源派生结果分开存放，文件按两空格缩进、末尾换行保存。

## 目录结构

~~~text
relay/
├─ minnano/
│  ├─ directory-progress.json    人物目录分批发现的翻页进度与源站报告人数
│  ├─ rankings.json              日、周、月榜
│  ├─ ranked-pool.json           三榜Top250累积人物：原生ID、姓名、首次/最近上榜时间
│  ├─ actresses.json             榜单及目录发现并逐次积累的人物名册
│  └─ avatars/                    minnano 女性头像，位于 female/，另有 index.json
├─ javdb/
│  ├─ web-genders.json           网页性别依据：原始标签、来源 URL、确认时间
│  ├─ actors.json                影片发现的演员集合，含男女及未知
│  ├─ uncensored-actors.json     无码影片样本中出现的人物
│  ├─ male-seed-actors.json      固定姓名种子查询结果，male 模式生成
│  └─ avatars/{female,male,unknown}/ID_姓名.jpg           普通与男演员种子工具共享的 JavDB 头像
└─ derived/
   ├─ female-name-index.json     跨来源女性姓名及别名反查索引
   ├─ avatar-supplements.json    为缺头像名册建立的补充资料映射
   └─ avatars/{female,male,unknown}/ID_姓名.jpg           跨来源补图缓存，缺 JavDB ID 时使用 mn_<mnid>
~~~

文件和图片目录按需生成；没有确认男性头像时，male/ 可以暂不存在。每个头像根目录的 index.json 记录实际路径，仅文件名发生大小写冲突时才追加区分后缀。具体规则见 ../docs/avatar-sources.md。

## 来源资料

minnano/rankings.json 保存 day、week、month 三种榜单；记录中的顺序有排名意义。minnano/actresses.json 保存姓名、minnano ID、别名、资料页和已回填的生日、尺寸等字段，包含榜单和目录发现者，尚未扫描的目录页不在其中；基础名册存在不代表详细资料已回填。

当前每榜保留Top250；ranked-pool.json 的 members 按原生ID累积曾上榜人物，落榜不删除。日常只补池内资料和图片，不继续全站目录。完整旧名册保留为存档；网页从池内人物生成minnano索引与详情，原始下载仍可取得完整存档。

javdb/actors.json 保存来源 ID、姓名、别名、作品数、性别与判定依据等，来自有限影片样本的逐次累积，不代表全库。javdb/uncensored-actors.json 额外保存本轮发现的 uc_count 和最多五个影片编号样本，男女均保留，不表示人物只出演这类影片。

javdb/male-seed-actors.json 特意包含 seed，明确它只是固定姓名种子搜索结果，不是完整男性目录。它与普通演员集合可能重叠，同一 ID 共享图片缓存，按已确认的性别归入 male/female/unknown。

## 派生结果

derived/female-name-index.json 是从 minnano 女性名册及 JavDB 已标为女性的记录生成的名字集合，条数不是人物数。姓名命中用于辅助判断，不会将两个站点的同名人物自动合并。

derived/avatar-supplements.json 保存缺图名册与补充来源的关联，结构为 { fetchedAt, count, map }。这是跨来源关联信息，不能混入任一站点的原生人物表。对应补图保存在 derived/avatars；源站直接抓到的头像仍分别保存在各自来源目录。

## 路径与维护

路径统一在 tools/lib/data-paths.js 定义，脚本不自行拼接其他来源的位置。RELAY_DIR 只覆盖总根目录，内部仍采用这套结构。默认根目录是项目 relay/；显式覆盖为相对路径时，以进程工作目录为基准。

目录整理已经同步所有采集器、测试和文档，没有保留重复的旧文件；旧 Raw URL 需要改为新路径。数据字段、来源 ID、数组顺序、抓取时间和图片字节不因目录调整而改变。现有数据做了字节校验，未重新抓取。

JSON 展开方便 Git 对比；相同业务排序值按 ID 破平，姓名集合稳定排序，榜单保留排名顺序。抓取时间变化仍会真实记录。

javdb/.line-ok 是运行时线路偏好缓存，已被 Git 忽略，不属于对外数据。资料页的请求缓存另放在项目 .cache/profiles 或 CACHE_DIR 下。

网页证据 javdb/web-genders.json 按 ID 保存，性别依据和人物资料分开；它保存 section-meta 原文，不是整页 HTML。来源数据文件仍只保存当前采集器选定的字段。

## 作品试采

works/ 下 records/<作品ID>.json 保存正式作品信息表，people/<人物ID>.json 保存列表关系、原观察和未知占位；progress.json 保存分页扫描及详情待办，report.json 保存最近一次运行结果。目前仅190754与125605两位试采，不表示全人物池作品库。封面只保存来源URL，未下载图片或视频。

JavDB作品补充位于javdb/work-enrichment：mappings.json以minnano作品ID映射JavDB原生作品ID，records/<JavDB ID>.json保存各自评分、元数据和有限短评快照。来源资料分开，不覆盖minnano作品；当前仅3部样本，评论不是全量，无自动刷新。
