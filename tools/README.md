# 工具阅读与运行索引

建议先读每个文件顶部 @file，了解输入输出及运行约束，再沿阶段注释阅读主流程，最后阅读函数 JSDoc。文件名、配置和运行行为保持稳定；格式与注释约定见 [代码规范](../docs/code-style.md)。

## 建议阅读顺序

1. rank-relay.js：从 HTML 解析到 JSON / 头像的最短采集链路，不依赖已有名册。
2. roster-avatars.js：理解已有名册、榜单补充与缺图补齐。
3. profiles-relay.js：理解资料解析、只填空、TTL 缓存和进度保存。
4. male-roster-relay.js：理解签名、多线路请求、精确姓名匹配、图片解码。
5. actors-full-crawl.js：理解影片反推演员、增量合并、性别兜底、补图。
6. uncensored-actresses-crawl.js：理解样本影片计数、多来源性别复用和安全阀。
7. gen-female-names.js：理解反查姓名集合的生成，它不会验证人物性别。
8. 三个 fix/verify 工具：理解人工批量复核及其不同的失败边界。

## 需要已有输入的工具

roster-avatars 与 profiles-relay 需要仓库根 relay/roster.json，当前目录没有预置该文件。

gen-female-names 使用 tools/actresses.json 和 tools/relay/ 下的演员文件，输出也在 tools/relay/；这些路径需要与调用环境核对。male-roster-relay 默认同样输出到 tools/relay/，可用 RELAY_DIR 覆盖。

actors-full-crawl 和 uncensored-actresses-crawl 默认使用仓库根 relay/，也支持 RELAY_DIR；名册和旧结果是可选输入，但缺失会影响性别推断与结果质量。

## 人工复核入口

~~~sh
node tools/fix-gender-by-web.js input.json output.json
node tools/verify-gender-local.js input.json output.json
node tools/verify-uc-gender.js input.json output.json 4
~~~

输入路径是示例，不能直接执行而期待存在文件。三个工具都依赖系统 curl，使用前阅读各自代理参数和覆盖行为。fix-gender-by-web 不把非空无标签页面当作失败，另外两个工具会返回 null；不能视为等价工具。

## 当前状态

文件注释可帮助阅读原实现，但并未修复冷启动、目录、性别推断、统计和缓存结构问题。没有统一采集入口、浏览网站或数据库。首次端到端采集留到后续功能修改阶段。
