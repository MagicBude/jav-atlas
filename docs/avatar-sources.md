# 头像来源与文件命名

当前方案：继续从 minnano/JavDB 自行抓取，不接入 Gfriends。下方外部来源研究作为备选记录，不代表已经实施。

## 头像文件名：来源 ID + 姓名

minnano 使用 `minnano/avatars/14008_大槻ひびき.jpg`。JavDB 与派生补图使用 `ID_姓名--ID编码.jpg`；例如 `0R5Na_ウルフ田中--3052354e61.jpg`。

ID 编码是原始 ID 的 UTF-8 十六进制表示，不是新增人物编号。JavDB ID 区分大小写，Windows 文件名通常不区分；末尾编码保证即使两人同名，`0R5Na` 与 `0R5na` 仍不会互相覆盖。minnano 的纯数字 ID 不需要编码。JSON 中原始 ID 保持不变，姓名方便直接浏览文件。

文件名由 `tools/lib/avatars.js` 统一生成。Windows 禁用字符替换为下划线，姓名最多保留 64 个 UTF-16 单元。姓名变更时按 ID 编码寻找并重命名已有缓存，不重复下载。同来源男演员与普通演员共用缓存；不同来源仍按目录区分。

已有旧头像可运行 `node tools/migrate-avatar-names.js --from-git`。脚本从 HEAD 分别恢复每张图，完整预检后迁移；本地存在未保存改图、未知 ID 或目标冲突时停止。已迁移的数据再次运行不会改动图片。旧 Raw 图片地址需要随新提交更新，JSON 数据路径不变；拼接 URL 时对文件名使用 `encodeURIComponent`。

## Gfriends 的实际能力

2026-10-20 检查 [gfriends/gfriends](https://github.com/gfriends/gfriends) 的官方说明与真实索引。它可提供十万级头像文件，但文件数不是演员数：同一人可能有不同来源、多张照片及优化副本，不能等同于所有演员均有头像。完整库约 10.3 GB，不需要复制全库。

[Filetree.json](https://raw.githubusercontent.com/gfriends/gfriends/master/Filetree.json) 约 6.5 MB，核心结构是 Content[来源目录][姓名.jpg] = 实际文件名?t=更新时间。索引快照与仓库首页数量可能不同，不能混用来宣称实时精确覆盖率。

例如 y-Minnano 的“三上悠亜.jpg”映射到“三上悠亜.jpg?t=1658331539”。在 z-ラグジュTV 中，“黒サリ.jpg”“Kurokawa Sarina.jpg”“Kaname Yuuna.jpg”“要ゆうな.jpg”共享真实文件“AI-Fix-黒川さりな.jpg?t=1607433809”。因此必须使用索引值定位文件，不能只用姓名键拼 URL。

不同来源独立保存人物图片，同一姓名的多图可带 -1、-2。官方说明的来源顺序与手工目录优先级应在选择候选时考虑，不能按字母排序随意取首项。规则见 [开发及调用说明](https://github.com/gfriends/gfriends#对女友仓库的开发及调用)。

索引确有男性头像，例如 9-Javrave 中的清水健、森林原人、吉村卓，不能说它只含女性；但没有男性、欧美或 JavDB 全库完整覆盖承诺。没有 minnano/JavDB ID 对照表，姓名和别名匹配仍是必要步骤。未命中不能据此断言人物不存在。

## 备选接入方式（当前不采用）

- 每轮由采集环境获取一次索引，以人物主名和已有别名找候选，不在浏览器逐人下载/扫描大索引。
- 对明确对应的候选记录 source、来源目录、真实文件名和图片 URL；同名存在冲突时不自动覆盖。
- 将选中的图片下载到对应来源 ID 的缓存路径；不改变人物 ID，不把同名数据自动合并为同一人。
- 可把 Gfriends 作为优先候选头像源，未匹配或不可用时继续回退 minnano/JavDB，再使用占位图。
- 使用索引的更新时间判断是否需要刷新，保留图片出处；完整图库不进入本仓库。

当前仅完成调研，尚未加入 Gfriends 下载器或姓名匹配适配，不会把计划写成已经实现。

## 使用范围

[项目使用条款](https://github.com/gfriends/gfriends#法律信息及免责声明) 限制技术/学术交流及非商业用途，图片版权仍属于来源网站或经纪公司，不能当成 MIT/CC0 图片库任意再许可。实际公开展示应遵循其条款并保留出处。
