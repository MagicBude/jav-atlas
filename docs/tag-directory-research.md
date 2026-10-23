# 类别目录核实

核实日期：2026-10-23。本轮只读访问目录，不抓作品、图片或评论，不修改relay。

## JavDB

实测既有移动接口v2/tags，type须为数字0至4；之前type=movie失败不是目录不可用，而是参数不正确。五次请求均HTTP200，data.tags包含分组，嵌套项保存id/name。本轮五类响应快照存.cache/javdb-tags-0.json至4.json，分组统计存.cache/tag-directory-evidence.json。

各类型的真实类别项出现次数（排除main/year/month/duration）：0为307，1为151，2为208，3为55，4为123，共844次，按类别ID去重327个。相同ID可能出现在多个类型/分组，正式词典应保留所有隶属关系，不能简单以最后出现位置覆盖。目录响应未提供分页或总量字段；可以称当前五类接口返回的目录快照，不能证明所有历史/隐藏标签均覆盖。

本轮只用来源实际响应作为结论。第三方接口记录提供数字type线索，并非官方完整性保证：https://raw.githubusercontent.com/ANDonekey/javapi/master/JavDB%20API/public/search-and-filters.md

## minnano

通过本机代理的SOCKS远端DNS路径成功访问actress_list.php与av_list.php，均取得有效网站标题与HTML。人物目录中出现112次标签链接，按tag_a_id去重为38个；这些来自当前页面人物条目，并非完整标签目录。作品列表页本轮未发现tag/genre链接；不据此断言源站没有作品类别。

未确认全站标签字典、全部分组入口或可穷尽的分页枚举。只能将38项称为当前人物页观察标签，且与JavDB作品类别分开维护。原HTML存.cache/minnano-tags-web.html和minnano-works-directory.html，链接提取结果minnano-tag-links.json。

## 后续词典约定

来源ID、来源名称、实体范围（人物/作品）、内容类型及分组是独立字段；中文显示名另存，不覆盖原名称。跨来源同名不能自动合并；未知翻译保留原文。目录快照与实际本地作品计数分离，不能让没有本地结果的目录项被误认为已采作品。

本轮没有建立中文译词或修改界面，原始快照只留本机.cache用于核实。若进入实施阶段，先将JavDB目录制成可重复更新的来源快照，再接本地中文显示字典；minnano继续标明观察范围，不宣称全量。
