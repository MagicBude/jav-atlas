# 工具索引

从文件顶部 @file 了解输入输出，再沿阶段注释阅读流程和函数 JSDoc。命令从仓库根运行，要求 Node.js 22+，无需安装第三方依赖。

## 常用入口

~~~sh
npm run check
npm test
npm run collect -- smoke all
npm run collect -- smoke javdb
~~~

collect.js 顺序执行并在失败时停止。bootstrap-roster.js 仅从新榜单建立初始名册，不代表完整目录。公共 JSON 工具见 lib/runtime.js；数据文件与图片目录的唯一约定见 lib/data-paths.js。

## 采集器

rank-relay.js 解析三种榜单并补部分头像，默认无名册也可运行。roster-avatars.js 依赖已有名册，支持数字 limit、full/0，不创建新名册。profiles-relay.js 回填已有 mnid 的空字段；PROFILE_LIMIT 控制本轮人数，成功缓存 TTL 为 20 小时，失败下次重试。

actors-full-crawl.js 从三个影片维度发现人物，仅补新 ID，并按 map 结构复用补图缓存。uncensored-actresses-crawl.js 生成包含男女及未知的出演名单，uc_count 仅为本轮不同影片编号数。male-roster-relay.js 单独按固定种子搜索，不代表全站男演员目录。

gen-female-names.js 将当前名册和已标为女性的人物姓名合并进已有集合，没有女性输入时不写空文件。所有采集器写入 RELAY_DIR 下的 minnano、javdb、derived 分类；默认总根是仓库 relay/。male 模式明确输出 javdb/male-seed-actors.json，并与普通 JavDB 采集共用 javdb/avatars。

## 人工复核

~~~sh
node tools/fix-gender-by-web.js input.json output.json
node tools/verify-gender-local.js input.json output.json
node tools/verify-uc-gender.js input.json output.json 4
~~~

这些工具依赖系统 curl，不在日常入口中自动执行。输入输出是示例路径；部分工具允许输出覆盖输入，没有自动备份。fix-gender-by-web 把非空无标签页面视为女性，另两个返回 null，不能视作等价工具。同步 curl 的异步化及判据统一留待后续处理。

格式与注释规则见 [代码规范](../docs/code-style.md)，采集验证范围见 [验证记录](../docs/validation.md)。
